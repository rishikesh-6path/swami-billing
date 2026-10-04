import { describe, expect, it } from 'vitest';
import { PostingError } from '../src/domain/posting/types.ts';
import { postVoucher } from '../src/domain/posting/post.ts';
import {
  creditCheck,
  createAccount,
  getAccount,
  getStaffMaxDiscountBp,
  journalMark,
  overLimitSince,
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

  it('never refuses a change that does not add to what they owe', () => {
    const s = seedShop();
    const first = postVoucher(s.db, bill(s)); // 1,180.00
    updateAccount(s.db, s.partyA, { creditLimitPaise: 50000 }); // the limit was lowered afterwards
    // correcting the same bill to a smaller amount is allowed even though it is still above the limit
    expect(
      creditCheck(s.db, { partyId: s.partyA, billPaise: 100000, excludeVoucherId: first.voucherId })
        ?.over,
    ).toBe(false);
    expect(
      creditCheck(s.db, { partyId: s.partyA, billPaise: 130000, excludeVoucherId: first.voucherId })
        ?.over,
    ).toBe(true);
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
    s.db.exec('UPDATE item SET sale_price_paise = 10000 WHERE id = 1');
    const lines = (discBp: number) => [
      { itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000, discBp },
    ];
    expect(staffDiscountProblem(s.db, bill(s, { lines: lines(500) }), 500)).toBeNull();
    expect(staffDiscountProblem(s.db, bill(s, { lines: lines(501) }), 500)).toMatch(/more than 5%/);
    expect(staffDiscountProblem(s.db, bill(s, { lines: lines(9000) }), 0)).toBeNull();
  });

  it('counts a lower price typed by hand as a discount, but not a higher price', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET sale_price_paise = 10000 WHERE id = 1');
    const priced = (listPricePaise: number) =>
      bill(s, { lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise }] });
    expect(staffDiscountProblem(s.db, priced(9500), 500)).toBeNull(); // 5% below
    expect(staffDiscountProblem(s.db, priced(6000), 500)).toMatch(/below its usual price/);
    expect(staffDiscountProblem(s.db, priced(12000), 500)).toBeNull(); // dearer is fine
  });

  it('adds the discount on the lines to money taken off at the bottom', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET sale_price_paise = 10000 WHERE id = 1');
    const withDiscount = (paise: number, discBp = 0) =>
      bill(s, {
        lines: [{ itemId: 1, qty: 10000, unitId: 1, listPricePaise: 10000, discBp }],
        sundries: [{ billSundryId: s.sundry.discount, amountPaise: paise }],
      });
    expect(staffDiscountProblem(s.db, withDiscount(5000), 500)).toBeNull(); // 5% of 1,000.00
    expect(staffDiscountProblem(s.db, withDiscount(5100), 500)).toMatch(/more than 5%/);
    // 4% on the lines and 4% at the bottom is about 8%, over a 5% limit
    expect(staffDiscountProblem(s.db, withDiscount(4000, 400), 500)).toMatch(/more than 5%/);
    expect(staffDiscountProblem(s.db, withDiscount(2000, 200), 500)).toBeNull(); // about 4%
    // freight adds money and is not a discount
    const freight = bill(s, { sundries: [{ billSundryId: s.sundry.freight, amountPaise: 90000 }] });
    expect(staffDiscountProblem(s.db, freight, 500)).toBeNull();
  });
});

describe('money received on a bill', () => {
  it('must go to a cash or bank account, never to the customer or another account', () => {
    const s = seedShop();
    const withSettlement = (accountId: number) =>
      bill(s, { settlements: [{ accountId, amountPaise: 50000 }] });
    expect(() => postVoucher(s.db, withSettlement(s.partyA))).toThrow(PostingError);
    expect(() => postVoucher(s.db, withSettlement(14))).toThrow(/cash or bank/); // an expense account
    const bank = 13; // GPAY SELVAM, a bank account in the test shop
    expect(postVoucher(s.db, withSettlement(bank)).voucherId).toBeGreaterThan(0);
  });
});

describe('credit limit after any change', () => {
  it('reports a customer a change took above their limit, but not one it made better', () => {
    const s = seedShop();
    updateAccount(s.db, s.partyA, { creditLimitPaise: 150000 });
    const first = journalMark(s.db);
    postVoucher(s.db, bill(s)); // 1,180.00: within the limit
    expect(overLimitSince(s.db, first)).toBeNull();
    const second = journalMark(s.db);
    postVoucher(s.db, bill(s)); // 2,360.00: over
    expect(overLimitSince(s.db, second)).toMatchObject({
      accountId: s.partyA,
      limitPaise: 150000,
      owingPaise: 236000,
    });
    // a receipt that brings them down is never reported, even while still above the limit
    const third = journalMark(s.db);
    postVoucher(s.db, {
      type: 'receipt',
      seriesId: s.seriesId.receipt,
      date: '2026-10-06',
      partyAccountId: s.partyA,
      entries: [
        { accountId: s.cash, side: 'dr', amountPaise: 10000 },
        { accountId: s.partyA, side: 'cr', amountPaise: 10000 },
      ],
    });
    expect(overLimitSince(s.db, third)).toBeNull();
  });
});

describe('staff discount when a bill is changed', () => {
  it('lets a bill made before a small price rise be corrected at its own price', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET sale_price_paise = 10000 WHERE id = 1');
    const old = postVoucher(s.db, bill(s));
    s.db.exec('UPDATE item SET sale_price_paise = 10400 WHERE id = 1'); // 4% dearer now
    const corrected = bill(s, {
      lines: [{ itemId: 1, qty: 9000, unitId: 1, listPricePaise: 10000 }],
    });
    expect(staffDiscountProblem(s.db, corrected, 500, old.voucherId)).toBeNull();
  });

  it('does not let a discount grow each time the bill is changed', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET sale_price_paise = 10000 WHERE id = 1');
    // first saved at 5% off (allowed), then changed to the discounted price with 5% off again
    const old = postVoucher(
      s.db,
      bill(s, { lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000, discBp: 500 }] }),
    );
    const again = bill(s, {
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 9500, discBp: 500 }],
    });
    expect(staffDiscountProblem(s.db, again, 500, old.voucherId)).toMatch(/below its usual price/);
  });
});
