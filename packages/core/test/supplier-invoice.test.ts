import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../src/domain/posting/post.ts';
import { modifyVoucher } from '../src/domain/posting/modify.ts';
import { getVoucherDetail, listVouchers } from '../src/domain/posting/detail.ts';
import { renderDocument } from '../src/print/invoice.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

const purchase = (s: Shop, over: object = {}) => ({
  type: 'purchase' as const,
  seriesId: s.seriesId.purchase,
  date: '2026-10-10',
  partyAccountId: s.partyB,
  taxMode: 'local' as const,
  lines: [{ itemId: 1, qty: 5000, unitId: 1, listPricePaise: 3000 }],
  ...over,
});

describe('supplier invoice number and date', () => {
  it('is stored, shown on the bill and findable by number', () => {
    const s = seedShop();
    const { voucherId } = postVoucher(
      s.db,
      purchase(s, { partyBillNo: ' INV/2026 / 77 ', partyBillDate: '2026-10-08' }),
    );
    const detail = getVoucherDetail(s.db, voucherId)!;
    expect(detail.partyBillNo).toBe('INV/2026 / 77');
    expect(detail.partyBillDate).toBe('2026-10-08');
    expect(listVouchers(s.db, { search: 'inv/2026' }).map((v) => v.id)).toEqual([voucherId]);
    const html = renderDocument(
      detail,
      { name: 'Shop', address: '', gstin: null, stateCode: '33', phone: null, invoiceFooter: '' },
      'a4',
    );
    expect(html).toContain('Supplier invoice: INV/2026 / 77 dated 08-10-2026');
  });

  it('is required when the supplier has a GSTIN, optional otherwise', () => {
    const s = seedShop();
    expect(() => postVoucher(s.db, purchase(s))).not.toThrow(); // supplier without GSTIN
    s.db.exec("UPDATE account SET gstin = '29AAPFU0939F1ZV' WHERE id = 12");
    expect(() => postVoucher(s.db, purchase(s))).toThrow(/invoice number and date/);
  });

  it('refuses the same supplier invoice twice in a year, but not after cancelling or for another supplier', () => {
    const s = seedShop();
    const first = postVoucher(
      s.db,
      purchase(s, { partyBillNo: 'A-1', partyBillDate: '2026-10-01' }),
    );
    expect(() =>
      postVoucher(s.db, purchase(s, { partyBillNo: 'a-1', partyBillDate: '2026-10-02' })),
    ).toThrow(/already entered as Purchase/);
    // another supplier may use the same number
    expect(() =>
      postVoucher(
        s.db,
        purchase(s, { partyAccountId: s.partyA, partyBillNo: 'A-1', partyBillDate: '2026-10-01' }),
      ),
    ).not.toThrow();
    // after cancelling, the number can be entered again
    cancelVoucher(s.db, first.voucherId);
    expect(() =>
      postVoucher(s.db, purchase(s, { partyBillNo: 'A-1', partyBillDate: '2026-10-01' })),
    ).not.toThrow();
  });

  it('can be corrected by changing the bill without tripping the duplicate rule on itself', () => {
    const s = seedShop();
    const first = postVoucher(
      s.db,
      purchase(s, { partyBillNo: 'B-9', partyBillDate: '2026-10-01' }),
    );
    const changed = modifyVoucher(
      s.db,
      first.voucherId,
      purchase(s, {
        partyBillNo: 'B-9',
        partyBillDate: '2026-10-01',
        lines: [{ itemId: 1, qty: 6000, unitId: 1, listPricePaise: 3000 }],
      }),
    );
    expect(getVoucherDetail(s.db, changed.voucherId)!.partyBillNo).toBe('B-9');
  });

  it('rejects half-entered, impossible, future-dated and over-long invoice details in plain words', () => {
    const s = seedShop();
    expect(() => postVoucher(s.db, purchase(s, { partyBillNo: 'X1' }))).toThrow(
      /date on the supplier/,
    );
    expect(() => postVoucher(s.db, purchase(s, { partyBillDate: '2026-10-01' }))).toThrow(
      /invoice number/,
    );
    expect(() =>
      postVoucher(s.db, purchase(s, { partyBillNo: 'X1', partyBillDate: '2026-02-30' })),
    ).toThrow(/not a real date/);
    expect(() =>
      postVoucher(s.db, purchase(s, { partyBillNo: 'X1', partyBillDate: '2026-10-11' })),
    ).toThrow(/dated after this purchase/);
    expect(() =>
      postVoucher(s.db, purchase(s, { partyBillNo: 'X'.repeat(31), partyBillDate: '2026-10-01' })),
    ).toThrow(/too long/);
  });

  it('is ignored on sales', () => {
    const s = seedShop();
    const { voucherId } = postVoucher(s.db, {
      type: 'sales',
      seriesId: s.seriesId.sales,
      date: '2026-10-10',
      partyAccountId: s.partyA,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 4500 }],
      partyBillNo: 'IGNORED',
      partyBillDate: '2026-10-01',
    });
    expect(getVoucherDetail(s.db, voucherId)!.partyBillNo).toBeNull();
  });
});
