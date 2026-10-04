import { describe, expect, it } from 'vitest';
import { postVoucher } from '../src/domain/posting/post.ts';
import {
  creditCheck,
  createAccount,
  getAccount,
  getStaffMaxDiscountBp,
  setStaffMaxDiscountBp,
  staffDiscountProblem,
  updateAccount,
  ValidationError,
  type ItemVoucherInput,
} from '../src/index.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

const bill = (s: Shop, over: Partial<ItemVoucherInput> = {}): ItemVoucherInput => ({
  type: 'sales',
  seriesId: s.seriesId.sales,
  date: '2026-10-05',
  partyAccountId: s.partyA,
  taxMode: 'local',
  roundOff: false,
  lines: [{ itemId: 1, qty: 10000, unitId: 1, listPricePaise: 10000 }], // taxable 1,000.00
  ...over,
});

describe('credit limit', () => {
  it('is stored on the party, defaults to none, and cannot be negative', () => {
    const s = seedShop();
    expect(getAccount(s.db, s.partyA)?.creditLimitPaise).toBe(0);
    updateAccount(s.db, s.partyA, { creditLimitPaise: 500000 });
    expect(getAccount(s.db, s.partyA)?.creditLimitPaise).toBe(500000);
    expect(() => updateAccount(s.db, s.partyA, { creditLimitPaise: -1 })).toThrow(ValidationError);
    const id = createAccount(s.db, {
      name: 'NEW CUSTOMER',
      groupId: getAccount(s.db, s.partyA)!.groupId,
      creditLimitPaise: 100,
    });
    expect(getAccount(s.db, id)?.creditLimitPaise).toBe(100);
  });

  it('says nothing when there is no limit, and for the shared Cash customer', () => {
    const s = seedShop();
    expect(creditCheck(s.db, { partyId: s.partyA, billPaise: 99_999_999 })).toBeNull();
    const cash = Number(s.db.prepare("SELECT id FROM account WHERE name = 'Cash'").get()?.['id']);
    s.db.prepare('UPDATE account SET credit_limit_paise = 100 WHERE id = ?').run(cash);
    expect(creditCheck(s.db, { partyId: cash, billPaise: 5000 })).toBeNull();
  });

  it('compares what they would owe after the bill with the limit', () => {
    const s = seedShop();
    updateAccount(s.db, s.partyA, { creditLimitPaise: 150000 }); // 1,500.00
    postVoucher(s.db, bill(s)); // 1,180.00 on credit
    const owing = creditCheck(s.db, { partyId: s.partyA, billPaise: 0 });
    expect(owing).toMatchObject({ owingPaise: 118000, over: false });
    expect(creditCheck(s.db, { partyId: s.partyA, billPaise: 30000 })).toMatchObject({
      afterPaise: 148000,
      over: false,
    });
    expect(creditCheck(s.db, { partyId: s.partyA, billPaise: 40000 })).toMatchObject({
      afterPaise: 158000,
      limitPaise: 150000,
      over: true,
    });
  });

  it('is not over when the bill adds nothing to what they owe, even if they are already above', () => {
    const s = seedShop();
    postVoucher(s.db, bill(s));
    updateAccount(s.db, s.partyA, { creditLimitPaise: 50000 }); // already above
    expect(creditCheck(s.db, { partyId: s.partyA, billPaise: 0 })?.over).toBe(false);
    expect(creditCheck(s.db, { partyId: s.partyA, billPaise: 1 })?.over).toBe(true);
  });

  it('does not count the bill being changed twice', () => {
    const s = seedShop();
    updateAccount(s.db, s.partyA, { creditLimitPaise: 150000 });
    const first = postVoucher(s.db, bill(s)); // 1,180.00
    const check = creditCheck(s.db, {
      partyId: s.partyA,
      billPaise: 118000,
      excludeVoucherId: first.voucherId,
    });
    expect(check).toMatchObject({ owingPaise: 0, afterPaise: 118000, over: false });
  });
});

describe('staff discount limit', () => {
  it('is off by default and is changed with an audit row', () => {
    const s = seedShop();
    expect(getStaffMaxDiscountBp(s.db)).toBe(0);
    setStaffMaxDiscountBp(s.db, 500, { userId: undefined });
    expect(getStaffMaxDiscountBp(s.db)).toBe(500);
    expect(() => setStaffMaxDiscountBp(s.db, 10001)).toThrow(ValidationError);
    expect(() => setStaffMaxDiscountBp(s.db, -1)).toThrow(ValidationError);
    const n = Number(
      s.db
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'discount_limit_changed'")
        .get()?.['n'],
    );
    expect(n).toBe(1);
  });

  it('refuses a line discount above the limit and allows one at the limit', () => {
    const s = seedShop();
    const lines = (discBp: number) => [
      { itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000, discBp },
    ];
    expect(staffDiscountProblem(s.db, bill(s, { lines: lines(500) }), 500)).toBeNull();
    expect(staffDiscountProblem(s.db, bill(s, { lines: lines(501) }), 500)).toMatch(/more than 5%/);
    expect(staffDiscountProblem(s.db, bill(s, { lines: lines(9000) }), 0)).toBeNull();
  });

  it('also covers money taken off at the bottom of the bill', () => {
    const s = seedShop();
    const withDiscount = (paise: number) =>
      bill(s, { sundries: [{ billSundryId: s.sundry.discount, amountPaise: paise }] });
    expect(staffDiscountProblem(s.db, withDiscount(5000), 500)).toBeNull(); // 5% of 1,000.00
    expect(staffDiscountProblem(s.db, withDiscount(5100), 500)).toMatch(/money taken off/);
    // freight adds money and is not a discount
    const freight = bill(s, { sundries: [{ billSundryId: s.sundry.freight, amountPaise: 90000 }] });
    expect(staffDiscountProblem(s.db, freight, 500)).toBeNull();
  });
});
