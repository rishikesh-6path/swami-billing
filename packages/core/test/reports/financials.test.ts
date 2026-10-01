import { describe, expect, it } from 'vitest';
import { postVoucher } from '../../src/domain/posting/post.ts';
import { balanceSheet, profitAndLoss } from '../../src/reports/financials.ts';
import { seedShop, type Shop } from '../helpers/shop.ts';

const FY = { from: '2026-04-01', to: '2027-03-31' };

function purchase(s: Shop, qty: number, price: number) {
  return postVoucher(s.db, {
    type: 'purchase',
    seriesId: s.seriesId.purchase,
    date: '2026-05-01',
    partyAccountId: s.partyB,
    taxMode: 'local',
    roundOff: false,
    lines: [{ itemId: 1, qty, unitId: 1, listPricePaise: price }],
  });
}
function sale(s: Shop, qty: number, price: number) {
  return postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date: '2026-06-01',
    partyAccountId: s.cash,
    taxMode: 'local',
    roundOff: false,
    lines: [{ itemId: 1, qty, unitId: 1, listPricePaise: price }],
  });
}

describe('profitAndLoss', () => {
  it('computes gross and net profit with stock at weighted-average cost', () => {
    const s = seedShop();
    purchase(s, 10000, 10000); // 10 pcs at 100.00 = 1000.00
    sale(s, 4000, 15000); // 4 pcs at 150.00 = 600.00
    // an expense: rent 50.00 paid in cash
    s.db.exec("INSERT INTO account (id, name, group_id) VALUES (20, 'Shop Rent', 9)");
    postVoucher(s.db, {
      type: 'payment',
      seriesId: s.seriesId.payment,
      date: '2026-06-02',
      entries: [
        { accountId: 20, side: 'dr', amountPaise: 5000 },
        { accountId: s.cash, side: 'cr', amountPaise: 5000 },
      ],
    });
    const p = profitAndLoss(s.db, FY);
    expect(p.sales[0]!.amountPaise).toBe(60000);
    expect(p.purchases[0]!.amountPaise).toBe(100000);
    expect(p.closingStockPaise).toBe(60000); // 6 pcs left at 100.00
    expect(p.grossProfitPaise).toBe(60000 + 60000 - 100000); // 200.00
    expect(p.netProfitPaise).toBe(20000 - 5000);
  });

  it('values opening stock from the item master', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET opening_qty = 2000, opening_rate_paise = 5000 WHERE id = 1');
    const p = profitAndLoss(s.db, FY);
    expect(p.openingStockPaise).toBe(10000);
    expect(p.closingStockPaise).toBe(10000);
    expect(p.grossProfitPaise).toBe(0);
  });
});

describe('balanceSheet', () => {
  it('balances once openings balance, and shows the difference when they do not', () => {
    const s = seedShop();
    // capital 1000.00 introduced as cash
    s.db.exec('UPDATE account SET opening_balance_paise = 100000, opening_is_dr = 1 WHERE id = 1');
    s.db.exec(
      "INSERT INTO account (id, name, group_id, opening_balance_paise, opening_is_dr) VALUES (21, 'Owner Capital', 1, 100000, 0)",
    );
    purchase(s, 10000, 10000);
    sale(s, 4000, 15000);
    const b = balanceSheet(s.db, { asOn: '2026-12-31' });
    expect(b.openingDifferencePaise).toBe(0);
    expect(b.totalAssetsPaise).toBe(b.totalLiabilitiesPaise);

    s.db.exec('UPDATE account SET opening_balance_paise = 90000 WHERE id = 21');
    const off = balanceSheet(s.db, { asOn: '2026-12-31' });
    expect(off.openingDifferencePaise).toBe(10000);
    expect(off.totalAssetsPaise).toBe(off.totalLiabilitiesPaise);
  });

  it('includes profit of earlier periods', () => {
    const s = seedShop();
    purchase(s, 10000, 10000);
    sale(s, 4000, 15000);
    const b = balanceSheet(s.db, { asOn: '2027-03-31' });
    expect(b.netProfitPaise).toBe(
      profitAndLoss(s.db, { from: '1970-01-01', to: '2027-03-31' }).netProfitPaise,
    );
    expect(b.netProfitPaise).toBe(20000);
  });
});
