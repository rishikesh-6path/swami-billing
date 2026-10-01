import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../../src/domain/posting/post.ts';
import { itemLedger, itemLedgerToCsv, stockStatus } from '../../src/reports/stock.ts';
import { seedShop, type Shop } from '../helpers/shop.ts';

function purchase(s: Shop, qty: number, price: number, date = '2026-10-01') {
  return postVoucher(s.db, {
    type: 'purchase',
    seriesId: s.seriesId.purchase,
    date,
    partyAccountId: s.partyB,
    taxMode: 'local',
    lines: [{ itemId: 1, qty, unitId: 1, listPricePaise: price }],
  });
}
function sale(s: Shop, qty: number, date = '2026-10-02') {
  return postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date,
    partyAccountId: s.partyA,
    taxMode: 'local',
    lines: [{ itemId: 1, qty, unitId: 1, listPricePaise: 20000 }],
  });
}
const row = (s: Shop, asOn: string) =>
  stockStatus(s.db, { asOn }).rows.find((r) => r.itemId === 1)!;

describe('stockStatus', () => {
  it('is opening plus purchases minus sales as of the date', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET opening_qty = 5000, opening_rate_paise = 8000 WHERE id = 1');
    purchase(s, 10000, 10000);
    sale(s, 3000);
    expect(row(s, '2026-10-31').qty).toBe(12000);
    expect(row(s, '2026-10-01').qty).toBe(15000); // before the sale
  });

  it('values stock at weighted-average purchase cost and never counts negative stock', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET opening_qty = 5000, opening_rate_paise = 8000 WHERE id = 1');
    purchase(s, 10000, 10000);
    // basis: 5 x 80.00 + 10 x 100.00 = 1400.00 over 15 units; 12 on hand after selling 3
    sale(s, 3000);
    expect(row(s, '2026-10-31').valuePaise).toBe(112000);
    sale(s, 20000);
    const after = row(s, '2026-10-31');
    expect(after.qty).toBe(-8000);
    expect(after.isNegative).toBe(true);
    expect(after.valuePaise).toBe(0);
  });

  it('ignores cancelled vouchers', () => {
    const s = seedShop();
    const p = purchase(s, 10000, 10000);
    cancelVoucher(s.db, p.voucherId);
    expect(row(s, '2026-10-31').qty).toBe(0);
  });

  it('flags items below their minimum and can list only problems', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET min_stock_qty = 5000, opening_qty = 2000 WHERE id = 1');
    const r = row(s, '2026-10-31');
    expect(r.isBelowMinimum).toBe(true);
    const problems = stockStatus(s.db, { asOn: '2026-10-31', onlyProblems: true });
    expect(problems.rows.map((x) => x.itemId)).toEqual([1]);
  });
});

describe('itemLedger', () => {
  it('lists movements with a running balance and a period opening', () => {
    const s = seedShop();
    purchase(s, 10000, 10000, '2026-10-01');
    sale(s, 4000, '2026-10-05');
    const full = itemLedger(s.db, { itemId: 1, from: '2026-04-01', to: '2026-12-31' });
    expect(full.rows.map((r) => r.balanceQty)).toEqual([10000, 6000]);
    expect(full.closingQty).toBe(6000);

    const later = itemLedger(s.db, { itemId: 1, from: '2026-10-05', to: '2026-12-31' });
    expect(later.openingQty).toBe(10000);
    expect(later.rows).toHaveLength(1);
    expect(itemLedgerToCsv(later)).toContain('Closing');
  });

  it('hides cancelled vouchers', () => {
    const s = seedShop();
    const p = purchase(s, 10000, 10000);
    cancelVoucher(s.db, p.voucherId);
    expect(itemLedger(s.db, { itemId: 1, from: '2026-04-01', to: '2026-12-31' }).rows).toEqual([]);
  });
});
