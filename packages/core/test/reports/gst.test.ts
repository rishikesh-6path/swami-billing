import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../../src/domain/posting/post.ts';
import { gstPeriod, offlineDate, placeOfSupplyLabel } from '../../src/reports/gst/common.ts';
import { gstr1, gstr1ToCsvFiles } from '../../src/reports/gst/gstr1.ts';
import { gstr3b } from '../../src/reports/gst/gstr3b.ts';
import { gstSummary } from '../../src/reports/gst/summary.ts';
import { seedShop, type Shop } from '../helpers/shop.ts';

const P = { from: '2026-10-01', to: '2026-10-31' };

function sale(s: Shop, over: object = {}, price = 10000, itemId = 1, qty = 1000) {
  return postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date: '2026-10-05',
    partyAccountId: s.partyB,
    taxMode: 'local',
    roundOff: false,
    lines: [{ itemId, qty, unitId: itemId === 2 ? 2 : 1, listPricePaise: price }],
    ...over,
  });
}
function shop() {
  const s = seedShop();
  s.db.exec("UPDATE account SET gstin = '33ABCDE1234F1Z5', state_code = '33' WHERE id = 11");
  return s;
}

describe('period helpers', () => {
  it('builds monthly and quarterly ranges within a financial year', () => {
    expect(gstPeriod('month', 2026, 1)).toEqual({ from: '2026-04-01', to: '2026-04-30' });
    expect(gstPeriod('month', 2026, 12)).toEqual({ from: '2027-03-01', to: '2027-03-31' });
    expect(gstPeriod('quarter', 2026, 3)).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(() => gstPeriod('quarter', 2026, 5)).toThrow(RangeError);
  });
  it('formats dates and places of supply for the offline tool', () => {
    expect(offlineDate('2026-10-05')).toBe('05-Oct-26');
    expect(placeOfSupplyLabel('33')).toBe('33-Tamil Nadu');
  });
});

describe('gstSummary', () => {
  it('nets output by rate, subtracts returns and compares with input tax', () => {
    const s = shop();
    const first = sale(s, { partyAccountId: s.partyA });
    sale(s, {}, 20000, 3); // item 3 at 5%
    postVoucher(s.db, {
      type: 'sales_return',
      seriesId: s.seriesId.sales_return,
      date: '2026-10-06',
      partyAccountId: s.partyA,
      refVoucherId: first.voucherId,
      taxMode: 'local',
      roundOff: false,
      lines: [{ itemId: 1, qty: 500, unitId: 1, listPricePaise: 10000 }].map((l) => ({
        ...l,
        qty: 1000,
      })),
    });
    postVoucher(s.db, {
      type: 'purchase',
      seriesId: s.seriesId.purchase,
      date: '2026-10-07',
      partyAccountId: s.partyB,
      taxMode: 'local',
      roundOff: false,
      lines: [{ itemId: 1, qty: 3000, unitId: 1, listPricePaise: 10000 }],
    });
    const g = gstSummary(s.db, P);
    expect(g.output.map((r) => [r.rateBp, r.taxablePaise])).toEqual([
      [500, 20000],
      [1800, 0], // sale and full return cancel out
    ]);
    expect(g.outputTax.totalPaise).toBe(1000);
    expect(g.inputTax.totalPaise).toBe(5400);
    expect(g.netPayablePaise).toBe(1000 - 5400);
  });

  it('ignores cancelled vouchers', () => {
    const s = shop();
    cancelVoucher(s.db, sale(s).voucherId);
    expect(gstSummary(s.db, P).output).toEqual([]);
  });
});

describe('gstr1', () => {
  it('splits registered invoices (table 4) from unregistered sales (table 7)', () => {
    const s = shop();
    sale(s, { partyAccountId: s.partyA }, 10000);
    sale(s, { partyAccountId: s.partyB }, 20000);
    const r = gstr1(s.db, P);
    expect(r.b2b).toMatchObject([
      {
        gstin: '33ABCDE1234F1Z5',
        docNumber: '1',
        rateBp: 1800,
        taxablePaise: 10000,
        invoiceValuePaise: 11800,
      },
    ]);
    expect(r.b2cs).toEqual([
      {
        pos: '33',
        rateBp: 1800,
        taxablePaise: 20000,
        cgstPaise: 1800,
        sgstPaise: 1800,
        igstPaise: 0,
      },
    ]);
  });

  it('reports an inter-state unregistered invoice above 2.5 lakh in table 5', () => {
    const s = shop();
    s.db.exec("UPDATE account SET state_code = '29' WHERE id = 12");
    sale(s, { partyAccountId: s.partyB, taxMode: 'interstate' }, 30000000);
    const r = gstr1(s.db, P);
    expect(r.b2cl).toHaveLength(1);
    expect(r.b2cl[0]!.pos).toBe('29');
    expect(r.b2cs).toEqual([]);
  });

  it('lists credit notes with the original invoice and nets the HSN summary', () => {
    const s = shop();
    const first = sale(s, { partyAccountId: s.partyA }, 10000, 1, 3000);
    postVoucher(s.db, {
      type: 'sales_return',
      seriesId: s.seriesId.sales_return,
      date: '2026-10-09',
      partyAccountId: s.partyA,
      refVoucherId: first.voucherId,
      taxMode: 'local',
      roundOff: false,
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    });
    const r = gstr1(s.db, P);
    expect(r.notes).toMatchObject([
      { kind: 'cdnr', refDocNumber: '1', refDate: '2026-10-05', taxablePaise: 10000 },
    ]);
    expect(r.hsn).toMatchObject([{ hsn: '73079990', uqc: 'PCS', qty: 2000, taxablePaise: 20000 }]);
  });

  it('counts documents issued including cancelled numbers (table 13)', () => {
    const s = shop();
    sale(s);
    cancelVoucher(s.db, sale(s).voucherId);
    sale(s);
    expect(gstr1(s.db, P).documents).toEqual([
      { nature: 'Invoices for outward supply', from: '1', to: '3', total: 3, cancelled: 1 },
    ]);
  });

  it('renders offline-tool style CSV files', () => {
    const s = shop();
    sale(s, { partyAccountId: s.partyA });
    const files = gstr1ToCsvFiles(gstr1(s.db, P));
    expect(Object.keys(files).sort()).toEqual([
      'b2b.csv',
      'b2cl.csv',
      'b2cs.csv',
      'cdnr.csv',
      'docs.csv',
      'hsn.csv',
    ]);
    expect(files['b2b.csv']).toContain('33ABCDE1234F1Z5');
    expect(files['b2b.csv']).toContain('33-Tamil Nadu');
    expect(files['b2b.csv']).toContain('05-Oct-26');
  });
});

describe('gstr3b', () => {
  it('reports outward, nil-rated, inter-state and ITC figures', () => {
    const s = shop();
    s.db.exec("UPDATE account SET state_code = '29' WHERE id = 12");
    sale(s, { partyAccountId: s.partyA }, 10000);
    sale(s, { partyAccountId: s.partyB, taxMode: 'interstate' }, 5000);
    sale(s, { taxMode: 'exempt' }, 7000, 3);
    postVoucher(s.db, {
      type: 'purchase',
      seriesId: s.seriesId.purchase,
      date: '2026-10-07',
      partyAccountId: s.partyB,
      taxMode: 'local',
      roundOff: false,
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    });
    const r = gstr3b(s.db, P);
    expect(r.taxableOutward).toEqual({
      taxablePaise: 15000,
      igstPaise: 900,
      cgstPaise: 900,
      sgstPaise: 900,
    });
    expect(r.nilExemptOutward.taxablePaise).toBe(7000);
    expect(r.interStateUnregistered).toEqual([{ pos: '29', taxablePaise: 5000, igstPaise: 900 }]);
    expect(r.itc).toEqual({ igstPaise: 0, cgstPaise: 900, sgstPaise: 900 });
    expect(r.netTaxPayablePaise).toBe(2700 - 1800);
  });
});
