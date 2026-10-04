import { describe, expect, it } from 'vitest';
import { postVoucher } from '../src/domain/posting/post.ts';
import { getVoucherDetail } from '../src/domain/posting/detail.ts';
import { previewItemVoucher } from '../src/domain/posting/preview.ts';
import { PostingError } from '../src/domain/posting/types.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

const sale = (s: Shop, over: object = {}) =>
  postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date: '2026-10-05',
    partyAccountId: s.partyB,
    taxMode: 'local',
    roundOff: false,
    lines: [{ itemId: 1, qty: 10000, unitId: 1, listPricePaise: 10000 }],
    ...over,
  });
const salesReturn = (s: Shop, ref: number, over: object = {}) => ({
  type: 'sales_return' as const,
  seriesId: s.seriesId.sales_return,
  date: '2026-10-20',
  partyAccountId: s.partyB,
  refVoucherId: ref,
  taxMode: 'local' as const,
  roundOff: false,
  lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
  ...over,
});

describe('review: a return reverses exactly what the bill charged', () => {
  it('uses the GST rate of the original bill even if the rate changed since', () => {
    const s = seedShop();
    const original = sale(s); // item 1 is 18% on 2026-10-05
    s.db.exec(
      "INSERT INTO item_tax_rate (item_id, effective_from, rate_bp) VALUES (1, '2026-10-10', 2800)",
    );
    const input = salesReturn(s, original.voucherId);
    expect(previewItemVoucher(s.db, input).taxPaise).toBe(1800); // 18% of 100.00
    const r = postVoucher(s.db, input);
    const line = getVoucherDetail(s.db, r.voucherId)!.lines[0]!;
    expect(line.taxRateBp).toBe(1800);
  });

  it('uses the HSN of the original bill line, not the item master today', () => {
    const s = seedShop();
    const original = sale(s);
    s.db.exec("UPDATE item SET hsn = '85361010' WHERE id = 1");
    const r = postVoucher(s.db, salesReturn(s, original.voucherId));
    expect(getVoucherDetail(s.db, r.voucherId)!.lines[0]!.hsn).toBe(
      getVoucherDetail(s.db, original.voucherId)!.lines[0]!.hsn,
    );
  });

  it('must use the same GST type as the bill it reverses', () => {
    const s = seedShop();
    const original = sale(s, { taxMode: 'interstate' });
    expect(() => postVoucher(s.db, salesReturn(s, original.voucherId))).toThrow(PostingError);
    expect(
      postVoucher(s.db, salesReturn(s, original.voucherId, { taxMode: 'interstate' })).voucherId,
    ).toBeGreaterThan(0);
  });

  it('refuses an item that is on the bill twice at different rates, and keeps the item HSN when the bill line had none', () => {
    const s = seedShop();
    const twice = sale(s, {
      lines: [
        { itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 },
        { itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000, taxRateBp: 500 },
      ],
    });
    expect(() => postVoucher(s.db, salesReturn(s, twice.voucherId))).toThrow(/more than once/);
    const plain = sale(s);
    s.db.prepare('UPDATE voucher_item SET hsn = NULL WHERE voucher_id = ?').run(plain.voucherId);
    const r = postVoucher(s.db, salesReturn(s, plain.voucherId));
    expect(getVoucherDetail(s.db, r.voucherId)!.lines[0]!.hsn).toBe('73079990');
  });

  it('must be made out to the same party as the bill', () => {
    const s = seedShop();
    const original = sale(s);
    expect(() =>
      postVoucher(s.db, salesReturn(s, original.voucherId, { partyAccountId: s.partyA })),
    ).toThrow(/same party/);
  });
});

describe('review: the low stock warning on a bill', () => {
  const lines = (qtys: number[]) =>
    qtys.map((qty) => ({ itemId: 1, qty, unitId: 1, listPricePaise: 10000 }));
  const draft = (s: Shop, date: string, qtys: number[]) => ({
    type: 'sales' as const,
    seriesId: s.seriesId.sales,
    date,
    partyAccountId: s.partyB,
    taxMode: 'local' as const,
    lines: lines(qtys),
  });
  const warnings = (s: Shop, date: string, qtys: number[]) =>
    previewItemVoucher(s.db, draft(s, date, qtys)).problems.filter((p) => p.kind === 'warning');

  it('adds up the same item on several lines, and warns once', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET opening_qty = 10000 WHERE id = 1'); // 10 in stock
    expect(warnings(s, '2026-10-05', [6000])).toEqual([]);
    expect(warnings(s, '2026-10-05', [6000, 6000])).toHaveLength(1);
  });

  it('does not count a purchase dated after the bill', () => {
    const s = seedShop();
    postVoucher(s.db, {
      type: 'purchase',
      seriesId: s.seriesId.purchase,
      date: '2026-10-25',
      partyAccountId: s.partyB,
      taxMode: 'local',
      partyBillNo: 'LATER/1',
      partyBillDate: '2026-10-25',
      lines: [{ itemId: 1, qty: 50000, unitId: 1, listPricePaise: 5000 }],
    });
    expect(warnings(s, '2026-10-30', [5000])).toEqual([]);
    expect(warnings(s, '2026-10-05', [5000])).toHaveLength(1);
  });
});
