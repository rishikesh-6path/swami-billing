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

  it('must be made out to the same party as the bill', () => {
    const s = seedShop();
    const original = sale(s);
    expect(() =>
      postVoucher(s.db, salesReturn(s, original.voucherId, { partyAccountId: s.partyA })),
    ).toThrow(/same party/);
  });
});
