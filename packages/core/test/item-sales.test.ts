import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../src/domain/posting/post.ts';
import { itemSales, itemSalesToCsv, salesRegister } from '../src/index.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

const P = { from: '2026-10-01', to: '2026-10-31' };

function shop(): Shop {
  const s = seedShop();
  // 10 bought at 80.00 and 10 at 100.00: average cost 90.00
  for (const [no, price] of [
    ['B1', 8000],
    ['B2', 10000],
  ] as const) {
    postVoucher(s.db, {
      type: 'purchase',
      seriesId: s.seriesId.purchase,
      date: '2026-10-02',
      partyAccountId: s.partyB,
      taxMode: 'local',
      partyBillNo: no,
      partyBillDate: '2026-10-02',
      lines: [{ itemId: 1, qty: 10000, unitId: 1, listPricePaise: price }],
    });
  }
  return s;
}
const sale = (s: Shop, qty: number, price: number, date = '2026-10-05') =>
  postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date,
    partyAccountId: s.partyA,
    taxMode: 'local',
    lines: [{ itemId: 1, qty, unitId: 1, listPricePaise: price }],
  });

describe('what sold', () => {
  it('shows quantity, value before GST, cost at average cost and profit', () => {
    const s = shop();
    sale(s, 5000, 12000); // 5 at 120.00 = 600.00; cost 5 x 90.00 = 450.00
    const r = itemSales(s.db, P);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      qty: 5000,
      valuePaise: 60000,
      costPaise: 45000,
      profitPaise: 15000,
      marginBp: 2500,
    });
    expect(r.totals.valuePaise).toBe(salesRegister(s.db, P).totals.taxablePaise);
  });

  it('takes off returns and credit notes, leaves out cancelled bills and other periods', () => {
    const s = shop();
    const first = sale(s, 5000, 12000);
    cancelVoucher(s.db, sale(s, 2000, 12000).voucherId);
    sale(s, 1000, 12000, '2026-11-02'); // next month
    postVoucher(s.db, {
      type: 'sales_return',
      seriesId: s.seriesId.sales_return,
      date: '2026-10-07',
      partyAccountId: s.partyA,
      refVoucherId: first.voucherId,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 12000 }],
    });
    postVoucher(s.db, {
      type: 'credit_note',
      seriesId: s.seriesId.credit_note,
      date: '2026-10-08',
      partyAccountId: s.partyA,
      refVoucherId: first.voucherId,
      taxMode: 'local',
      narration: 'Rate difference',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 2000 }],
    });
    const r = itemSales(s.db, P).rows[0]!;
    expect(r.qty).toBe(4000); // 5 sold, 1 returned
    expect(r.valuePaise).toBe(60000 - 12000 - 2000);
    expect(r.costPaise).toBe(36000); // 4 x 90.00
    expect(r.profitPaise).toBe(46000 - 36000);
    expect(itemSales(s.db, P).totals.valuePaise).toBe(salesRegister(s.db, P).totals.taxablePaise);
  });

  it('can be limited to a group, and the spreadsheet adds up', () => {
    const s = shop();
    sale(s, 5000, 12000);
    expect(itemSales(s.db, { ...P, groupId: 99 }).rows).toEqual([]);
    const csv = itemSalesToCsv(itemSales(s.db, { ...P, groupId: 1 }));
    expect(csv.split('\n')[0]).toBe(
      'Group,Item,Alias,Unit,Quantity,Sales before GST,Cost,Profit,Margin %',
    );
    expect(csv).toContain('Total,,,,,600.00,450.00,150.00,25.00');
  });
});
