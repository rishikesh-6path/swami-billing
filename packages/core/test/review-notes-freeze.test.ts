import { describe, expect, it } from 'vitest';
import { postVoucher } from '../src/domain/posting/post.ts';
import { getVoucherDetail } from '../src/domain/posting/detail.ts';
import { gstr1 } from '../src/reports/gst/gstr1.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

const P = { from: '2026-10-01', to: '2026-10-31' };

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
const note = (s: Shop, ref: number, over: object = {}) =>
  postVoucher(s.db, {
    type: 'credit_note',
    seriesId: s.seriesId.credit_note,
    date: '2026-10-09',
    partyAccountId: s.partyB,
    refVoucherId: ref,
    taxMode: 'local',
    roundOff: false,
    narration: 'Rate difference',
    lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 5000 }],
    ...over,
  });

describe('review: note inherits what was frozen on the original bill', () => {
  it('uses the GSTIN of the original bill, not the one on the customer today', () => {
    const s = seedShop();
    const original = sale(s); // customer unregistered: a B2C sale, reported in table 7
    s.db.exec("UPDATE account SET gstin = '29AAPFU0939F1ZV' WHERE id = 12"); // registers later
    const n = note(s, original.voucherId);
    expect(getVoucherDetail(s.db, n.voucherId)!.party!.gstin).toBeNull();
    // the note must not appear in the credit notes (registered) table for an invoice not in table 4
    expect(gstr1(s.db, P).notes).toEqual([]);
  });

  it('uses the place of supply of the original inter-state bill, not the customer state today', () => {
    const s = seedShop();
    const original = sale(s, { taxMode: 'interstate' }); // customer state 29 (Karnataka)
    s.db.exec("UPDATE account SET state_code = '27' WHERE id = 12"); // master corrected later
    const n = note(s, original.voucherId, { taxMode: 'interstate' });
    expect(getVoucherDetail(s.db, n.voucherId)!.posStateCode).toBe(
      getVoucherDetail(s.db, original.voucherId)!.posStateCode,
    );
  });

  it('uses the HSN of the original bill line, not the item master today', () => {
    const s = seedShop();
    const original = sale(s);
    s.db.exec("UPDATE item SET hsn = '85361010' WHERE id = 1");
    const n = note(s, original.voucherId);
    expect(getVoucherDetail(s.db, n.voucherId)!.lines[0]!.hsn).toBe(
      getVoucherDetail(s.db, original.voucherId)!.lines[0]!.hsn,
    );
    // and the HSN summary must show one row for the goods, not two
    expect(gstr1(s.db, P).hsn).toHaveLength(1);
  });
});
