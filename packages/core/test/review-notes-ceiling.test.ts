import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../src/domain/posting/post.ts';
import { getVoucherDetail } from '../src/domain/posting/detail.ts';
import { gstSummary } from '../src/reports/gst/summary.ts';
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
    lines: [{ itemId: 1, qty: 10000, unitId: 1, listPricePaise: 10000 }], // total 1,18,000
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
    lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 60000 }], // 70,800
    ...over,
  });

describe('review: note ceiling and cancel', () => {
  it('a sales return after a credit note cannot take the total adjusted above the bill', () => {
    const s = seedShop();
    const original = sale(s);
    note(s, original.voucherId); // 70,800 of 1,18,000 already credited
    // full quantity returned at full price: 1,18,000 more, 1,88,800 in all against a 1,18,000 bill
    expect(() =>
      postVoucher(s.db, {
        type: 'sales_return',
        seriesId: s.seriesId.sales_return,
        date: '2026-10-10',
        partyAccountId: s.partyB,
        refVoucherId: original.voucherId,
        taxMode: 'local',
        roundOff: false,
        lines: [{ itemId: 1, qty: 10000, unitId: 1, listPricePaise: 10000 }],
      }),
    ).toThrow();
  });

  it('a purchase return after a debit note cannot take the total adjusted above the bill', () => {
    const s = seedShop();
    const bill = postVoucher(s.db, {
      type: 'purchase',
      seriesId: s.seriesId.purchase,
      date: '2026-10-05',
      partyAccountId: s.partyB,
      taxMode: 'local',
      roundOff: false,
      lines: [{ itemId: 1, qty: 10000, unitId: 1, listPricePaise: 10000 }],
    });
    postVoucher(s.db, {
      type: 'debit_note',
      seriesId: s.seriesId.debit_note,
      date: '2026-10-09',
      partyAccountId: s.partyB,
      refVoucherId: bill.voucherId,
      taxMode: 'local',
      roundOff: false,
      narration: 'Rate difference',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 60000 }],
    });
    expect(() =>
      postVoucher(s.db, {
        type: 'purchase_return',
        seriesId: s.seriesId.purchase_return,
        date: '2026-10-10',
        partyAccountId: s.partyB,
        refVoucherId: bill.voucherId,
        taxMode: 'local',
        roundOff: false,
        lines: [{ itemId: 1, qty: 10000, unitId: 1, listPricePaise: 10000 }],
      }),
    ).toThrow();
  });

  it('cancelling a bill that has a live credit note is refused (otherwise the note is left against a cancelled bill)', () => {
    const s = seedShop();
    const original = sale(s);
    note(s, original.voucherId);
    let cancelled = true;
    try {
      cancelVoucher(s.db, original.voucherId);
    } catch {
      cancelled = false;
    }
    // if allowed, output tax for the period goes negative: the sale is reversed but the note stays
    const out = gstSummary(s.db, P).outputTax.totalPaise;
    expect(cancelled && out < 0).toBe(false);
  });
});

describe('review: note must follow the original bill', () => {
  it('rejects a note line for an item that is not on the original bill', () => {
    const s = seedShop();
    const original = sale(s); // item 1 only, 18%
    // item 3 is a 5% item that was never sold on this bill
    expect(() =>
      note(s, original.voucherId, {
        lines: [{ itemId: 3, qty: 1000, unitId: 1, listPricePaise: 1000 }],
      }),
    ).toThrow();
  });

  it('an explicit rate must not override the rate frozen on the original bill', () => {
    const s = seedShop();
    const original = sale(s);
    // an explicit rate must not override the rate frozen on the original bill (28% vs 18%)
    let n: ReturnType<typeof note> | undefined;
    try {
      n = note(s, original.voucherId, {
        lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 1000, taxRateBp: 2800 }],
      });
    } catch {
      /* refusing is fine */
    }
    if (n) expect(getVoucherDetail(s.db, n.voucherId)!.lines[0]!.taxRateBp).toBe(1800);
  });
});
