import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../src/domain/posting/post.ts';
import { gstPurchases, gstPurchasesToCsv } from '../src/reports/gst/purchases.ts';
import { gstSummary } from '../src/reports/gst/summary.ts';
import { gstr3b } from '../src/reports/gst/gstr3b.ts';
import { reorderList, reorderToCsv } from '../src/reports/reorder.ts';
import { purchaseRegister, registerToCsv } from '../src/reports/registers.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

const P = { from: '2026-10-01', to: '2026-10-31' };
const purchase = (s: Shop, over: object = {}) =>
  postVoucher(s.db, {
    type: 'purchase',
    seriesId: s.seriesId.purchase,
    date: '2026-10-05',
    partyAccountId: s.partyB,
    taxMode: 'local',
    roundOff: false,
    partyBillNo: 'SUP/77',
    partyBillDate: '2026-10-03',
    lines: [{ itemId: 1, qty: 10000, unitId: 1, listPricePaise: 8000 }],
    ...over,
  });

describe('review: purchases file for the CA', () => {
  it('a debit note row names the original supplier invoice and its date (KICKOFF 8)', () => {
    const s = seedShop();
    const bill = purchase(s);
    postVoucher(s.db, {
      type: 'debit_note',
      seriesId: s.seriesId.debit_note,
      date: '2026-10-09',
      partyAccountId: s.partyB,
      refVoucherId: bill.voucherId,
      taxMode: 'local',
      roundOff: false,
      narration: 'Price reduction',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    });
    const csv = gstPurchasesToCsv(gstPurchases(s.db, P));
    const noteLine = csv.split('\n').find((l) => l.includes('Debit note')) ?? '';
    expect(noteLine).toContain('SUP/77');
    expect(noteLine).toContain('03-Oct-26');
  });

  it('place of supply on an inter-state purchase is the shop state, not the supplier state', () => {
    const s = seedShop(); // shop is 33 Tamil Nadu, supplier is 29 Karnataka
    purchase(s, { taxMode: 'interstate' });
    const csv = gstPurchasesToCsv(gstPurchases(s.db, P));
    const line = csv.split('\n')[1] ?? '';
    expect(line).toContain('33-Tamil Nadu');
    expect(line).not.toContain('29-Karnataka');
  });

  it('reconciles with the GST summary and GSTR-3B input tax, and the CSV widths match', () => {
    const s = seedShop();
    const bill = purchase(s);
    const gone = purchase(s, { partyBillNo: 'SUP/79' });
    cancelVoucher(s.db, gone.voucherId);
    purchase(s, { partyBillNo: 'I/1', taxMode: 'interstate' });
    purchase(s, { partyBillNo: 'E/1', taxMode: 'exempt' });
    postVoucher(s.db, {
      type: 'purchase_return',
      seriesId: s.seriesId.purchase_return,
      date: '2026-10-31',
      partyAccountId: s.partyB,
      refVoucherId: bill.voucherId,
      taxMode: 'local',
      roundOff: false,
      lines: [{ itemId: 1, qty: 3000, unitId: 1, listPricePaise: 8000 }],
    });
    const p = gstPurchases(s.db, P);
    const sum = gstSummary(s.db, P).inputTax;
    const b = gstr3b(s.db, P).itc;
    expect([p.totals.igstPaise, p.totals.cgstPaise, p.totals.sgstPaise]).toEqual([
      sum.igstPaise,
      sum.cgstPaise,
      sum.sgstPaise,
    ]);
    expect([p.totals.igstPaise, p.totals.cgstPaise, p.totals.sgstPaise]).toEqual([
      b.igstPaise,
      b.cgstPaise,
      b.sgstPaise,
    ]);
    const lines = gstPurchasesToCsv(p).trim().split('\n');
    expect(new Set(lines.map((l) => l.split(',').length)).size).toBe(1);
  });

  it('keeps hostile supplier names and invoice numbers from running as formulas', () => {
    const s = seedShop();
    s.db.exec(`UPDATE account SET name = '=HYPERLINK("http://x","y")' WHERE id = 12`);
    purchase(s, { partyBillNo: '@SUM(A1)' });
    const csv = gstPurchasesToCsv(gstPurchases(s.db, P));
    for (const cell of csv.split('\n')[1]!.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
      expect(cell).not.toMatch(/^"?[=@+-]/);
    }
    const reg = registerToCsv(purchaseRegister(s.db, P));
    expect(reg).not.toMatch(/(^|,)@SUM/);
  });
});

describe('review: reorder', () => {
  it('shows an item with no purchase, an unbought blank cost, and skips inactive items', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET min_stock_qty = 5000');
    s.db.exec('UPDATE item SET is_active = 0 WHERE id = 3');
    const rows = reorderList(s.db, { asOn: '2026-10-31' });
    expect(rows.map((r) => r.itemId).sort()).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({ lastSupplier: null, lastCostPaise: null, shortfallQty: 5000 });
    expect(reorderToCsv(rows).split('\n')).toHaveLength(4);
  });
});
