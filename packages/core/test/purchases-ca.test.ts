import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../src/domain/posting/post.ts';
import { gstPurchases, gstPurchasesToCsv } from '../src/reports/gst/purchases.ts';
import { purchaseRegister, registerToCsv } from '../src/reports/registers.ts';
import { reorderList, reorderToCsv } from '../src/reports/reorder.ts';
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
    lines: [{ itemId: 1, qty: 10000, unitId: 1, listPricePaise: 8000 }], // taxable 800.00
    ...over,
  });

describe('purchase register and the accountant purchases file', () => {
  it('show the supplier invoice number and date', () => {
    const s = seedShop();
    purchase(s);
    const reg = purchaseRegister(s.db, P);
    expect(reg.rows[0]).toMatchObject({ partyBillNo: 'SUP/77', partyBillDate: '2026-10-03' });
    const csv = registerToCsv(reg);
    expect(csv.split('\n')[0]).toContain('Supplier invoice no.');
    expect(csv).toContain('SUP/77');
    // every line has the same number of columns as the header
    const widths = new Set(
      csv
        .trim()
        .split('\n')
        .map((l) => l.split(',').length),
    );
    expect(widths.size).toBe(1);
  });

  it('lists each invoice by rate with returns and debit notes negative, and no cancelled bills', () => {
    const s = seedShop();
    const bill = purchase(s);
    purchase(s, {
      partyBillNo: 'SUP/78',
      lines: [{ itemId: 3, qty: 1000, unitId: 1, listPricePaise: 1000 }],
    }); // 5% item
    const gone = purchase(s, { partyBillNo: 'SUP/79' });
    cancelVoucher(s.db, gone.voucherId);
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
    const r = gstPurchases(s.db, P);
    expect(r.rows.map((x) => [x.invoiceNumber, x.kind, x.rateBp, x.taxablePaise])).toEqual([
      ['SUP/77', 'Purchase', 1800, 80000],
      ['SUP/78', 'Purchase', 500, 1000],
      ['', 'Debit note', 1800, -10000],
    ]);
    expect(r.rows[2]).toMatchObject({
      originalInvoiceNumber: 'SUP/77',
      originalInvoiceDate: '2026-10-03',
    });
    expect(r.totals.taxablePaise).toBe(80000 + 1000 - 10000);
    const csv = gstPurchasesToCsv(r);
    expect(csv).toContain('SUP/77');
    expect(csv).not.toContain('SUP/79');
  });
});

describe('reorder list', () => {
  it('lists items below their minimum with the last supplier and cost', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET min_stock_qty = 20000 WHERE id = 1');
    purchase(s, { lines: [{ itemId: 1, qty: 15000, unitId: 1, listPricePaise: 8000 }] });
    const rows = reorderList(s.db, { asOn: '2026-10-31' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      itemId: 1,
      qty: 15000,
      minStockQty: 20000,
      shortfallQty: 5000,
      lastSupplier: 'SELVAM TRADERS',
      lastCostPaise: 8000,
      lastBoughtOn: '2026-10-05',
    });
    expect(reorderToCsv(rows)).toContain('SELVAM TRADERS');
    // enough stock: not listed
    purchase(s, {
      partyBillNo: 'SUP/80',
      lines: [{ itemId: 1, qty: 10000, unitId: 1, listPricePaise: 8000 }],
    });
    expect(reorderList(s.db, { asOn: '2026-10-31' })).toEqual([]);
  });

  it('picks the newest posted purchase up to the date, ignoring cancelled bills and other items', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET min_stock_qty = 900000 WHERE id = 1');
    purchase(s, {
      date: '2026-10-05',
      partyBillNo: 'A',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 7000 }],
    });
    // two lines of one bill: the later line wins
    purchase(s, {
      date: '2026-10-07',
      partyBillNo: 'B',
      lines: [
        { itemId: 1, qty: 1000, unitId: 1, listPricePaise: 7100 },
        { itemId: 1, qty: 1000, unitId: 1, listPricePaise: 7200 },
      ],
    });
    // same day, later bill wins
    purchase(s, {
      date: '2026-10-07',
      partyBillNo: 'C',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 7300 }],
    });
    const cancelled = purchase(s, {
      date: '2026-10-09',
      partyBillNo: 'D',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 9900 }],
    });
    cancelVoucher(s.db, cancelled.voucherId);
    purchase(s, {
      date: '2026-12-01',
      partyBillNo: 'E',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 5000 }],
    });
    const at = (asOn: string) => reorderList(s.db, { asOn }).find((r) => r.itemId === 1);
    expect(at('2026-10-31')).toMatchObject({ lastCostPaise: 7300, lastBoughtOn: '2026-10-07' });
    expect(at('2026-12-31')).toMatchObject({ lastCostPaise: 5000, lastBoughtOn: '2026-12-01' });
    // an item never bought has no supplier or cost
    s.db.exec('UPDATE item SET min_stock_qty = 900000 WHERE id = 2');
    expect(reorderList(s.db, { asOn: '2026-10-31' }).find((r) => r.itemId === 2)).toMatchObject({
      lastSupplier: null,
      lastCostPaise: null,
      lastBoughtOn: null,
    });
  });
});
