import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../../src/domain/posting/post.ts';
import {
  getVoucherDetail,
  listVouchers,
  nextVoucherNumber,
} from '../../src/domain/posting/detail.ts';
import { searchParties } from '../../src/masters/accounts.ts';
import { seedShop, type Shop } from '../helpers/shop.ts';

const sale = (s: Shop, over: object = {}) =>
  postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date: '2026-10-01',
    partyAccountId: s.partyA,
    taxMode: 'local',
    roundOff: false,
    narration: 'Being goods sold',
    lines: [{ itemId: 1, qty: 2000, unitId: 1, listPricePaise: 10000 }],
    sundries: [{ billSundryId: s.sundry.freight, amountPaise: 500 }],
    settlements: [{ accountId: s.cash, amountPaise: 1000 }],
    ...over,
  });

describe('nextVoucherNumber', () => {
  it('counts per series and year, and starts at 1', () => {
    const s = seedShop();
    expect(nextVoucherNumber(s.db, 'sales', s.seriesId.sales, '2026-10-01')).toBe(1);
    sale(s);
    sale(s);
    expect(nextVoucherNumber(s.db, 'sales', s.seriesId.sales, '2026-10-01')).toBe(3);
    expect(nextVoucherNumber(s.db, 'sales', s.seriesId.sales, '2030-01-01')).toBe(1); // no such year yet
  });
});

describe('getVoucherDetail', () => {
  it('returns everything needed to show, copy or print a bill', () => {
    const s = seedShop();
    s.db.exec("UPDATE voucher_series SET prefix = 'S-' WHERE id = " + s.seriesId.sales);
    const id = sale(s).voucherId;
    const d = getVoucherDetail(s.db, id)!;
    expect(d).toMatchObject({
      voucherType: 'sales',
      number: 1,
      displayNumber: 'S-1',
      status: 'posted',
      party: { name: 'AYAPPAN PIPE KUTTALAM', stateCode: '29' },
      narration: 'Being goods sold',
      posStateCode: '33',
    });
    expect(d.lines).toMatchObject([
      {
        itemName: 'GI CLAMP',
        unitName: 'Pcs',
        qty: 2000,
        pricePaise: 10000,
        amountPaise: 20000,
        taxRateBp: 1800,
      },
    ]);
    expect(d.sundries).toEqual([
      { billSundryId: s.sundry.freight, name: 'Freight & Forwarding', sign: 1, amountPaise: 500 },
    ]);
    expect(d.settlements).toEqual([{ accountId: s.cash, accountName: 'Cash', amountPaise: 1000 }]);
    expect(d.entries.some((e) => e.accountName === 'Sales' && e.side === 'cr')).toBe(true);
    expect(getVoucherDetail(s.db, 999)).toBeUndefined();
  });

  it('links a return to the invoice it refers to', () => {
    const s = seedShop();
    const first = sale(s).voucherId;
    const ret = postVoucher(s.db, {
      type: 'sales_return',
      seriesId: s.seriesId.sales_return,
      date: '2026-10-02',
      partyAccountId: s.partyA,
      refVoucherId: first,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    }).voucherId;
    expect(getVoucherDetail(s.db, ret)!.refVoucher).toEqual({
      id: first,
      displayNumber: '1',
      date: '2026-10-01',
    });
  });
});

describe('listVouchers', () => {
  it('lists newest first, hides cancelled ones unless asked, and filters', () => {
    const s = seedShop();
    const a = sale(s);
    sale(s, { date: '2026-10-03', partyAccountId: s.partyB });
    cancelVoucher(s.db, a.voucherId, { reason: 'Wrong customer' });
    expect(listVouchers(s.db).map((v) => v.date)).toEqual(['2026-10-03']);
    expect(listVouchers(s.db, { includeCancelled: true }).map((v) => v.status)).toEqual([
      'posted',
      'cancelled',
    ]);
    expect(listVouchers(s.db, { search: 'selvam' })).toHaveLength(1);
    expect(listVouchers(s.db, { search: 'goods sold', includeCancelled: true })).toHaveLength(2);
    expect(listVouchers(s.db, { voucherType: 'receipt' })).toEqual([]);
    expect(listVouchers(s.db, { from: '2026-10-02', to: '2026-10-31' })).toHaveLength(1);
    expect(
      s.db.prepare("SELECT after_json FROM audit_log WHERE action = 'cancel'").get()!['after_json'],
    ).toContain('Wrong customer');
  });
});

describe('searchParties', () => {
  it('offers Cash first for customers and finds parties by name, phone or GSTIN', () => {
    const s = seedShop();
    s.db.exec("UPDATE account SET phone = '9840012345', gstin = '33AAPFU0939F1Z2' WHERE id = 11");
    const names = (text: string, kind: 'customer' | 'supplier' | 'any') =>
      searchParties(s.db, { text, kind, asOn: '2026-10-01' }).map((p) => p.name);
    expect(names('', 'customer')).toEqual(['Cash', 'AYAPPAN PIPE KUTTALAM', 'SELVAM TRADERS']);
    expect(names('ayap', 'customer')).toEqual(['AYAPPAN PIPE KUTTALAM']);
    expect(names('98400', 'customer')).toEqual(['AYAPPAN PIPE KUTTALAM']);
    expect(names('33aapfu', 'customer')).toEqual(['AYAPPAN PIPE KUTTALAM']);
    expect(names('', 'supplier')).toEqual([]);
    expect(names('%', 'customer')).toEqual([]); // % is a literal character, not a wildcard
  });

  it('shows what each party owes or is owed', () => {
    const s = seedShop();
    sale(s);
    const [hit] = searchParties(s.db, { text: 'ayap', kind: 'customer', asOn: '2026-10-01' });
    expect(hit!.balancePaise).toBe(24190 - 1000); // 205.00 + 18% tax = 241.90, less 10.00 received // 200 + 5 freight + 18% tax on 205 - 10 received
  });
});
