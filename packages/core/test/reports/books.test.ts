import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../../src/domain/posting/post.ts';
import { dayBook, daySummary } from '../../src/reports/daybook.ts';
import { outstanding } from '../../src/reports/outstanding.ts';
import { purchaseRegister, registerToCsv, salesRegister } from '../../src/reports/registers.ts';
import { trialBalance } from '../../src/reports/trial-balance.ts';
import { seedShop, type Shop } from '../helpers/shop.ts';

const sale = (s: Shop, date: string, price: number, party = s.partyA, over: object = {}) =>
  postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date,
    partyAccountId: party,
    taxMode: 'local',
    roundOff: false,
    lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: price }],
    ...over,
  });
const receipt = (s: Shop, date: string, amount: number, party = s.partyA) =>
  postVoucher(s.db, {
    type: 'receipt',
    seriesId: s.seriesId.receipt,
    date,
    partyAccountId: party,
    entries: [
      { accountId: s.cash, side: 'dr', amountPaise: amount },
      { accountId: party, side: 'cr', amountPaise: amount },
    ],
  });
const FY = { from: '2026-04-01', to: '2027-03-31' };

describe('trialBalance', () => {
  it('has equal period debits and credits and carries openings forward', () => {
    const s = seedShop();
    s.db.exec('UPDATE account SET opening_balance_paise = 5000, opening_is_dr = 1 WHERE id = 11');
    sale(s, '2026-05-01', 10000);
    receipt(s, '2026-10-02', 4000);
    const tb = trialBalance(s.db, FY);
    expect(tb.totalDrPaise).toBe(tb.totalCrPaise);
    const party = tb.rows.find((r) => r.accountId === s.partyA)!;
    expect(party.openingPaise).toBe(5000);
    expect(party.closingPaise).toBe(5000 + 11800 - 4000);
    expect(tb.openingDifferencePaise).toBe(5000); // the entered opening does not balance by itself
  });

  it('puts earlier movement into a later period opening and hides empty accounts', () => {
    const s = seedShop();
    sale(s, '2026-05-01', 10000);
    const tb = trialBalance(s.db, { from: '2026-06-01', to: '2026-06-30' });
    expect(tb.rows.find((r) => r.accountId === s.partyA)!.openingPaise).toBe(11800);
    expect(tb.rows.find((r) => r.accountId === s.partyB)).toBeUndefined();
  });
});

describe('dayBook and daySummary', () => {
  it('lists vouchers, marks cancelled ones and summarises the day', () => {
    const s = seedShop();
    s.db.exec('UPDATE account SET opening_balance_paise = 1000, opening_is_dr = 1 WHERE id = 1');
    sale(s, '2026-10-01', 10000);
    const gone = sale(s, '2026-10-01', 5000);
    cancelVoucher(s.db, gone.voucherId);
    receipt(s, '2026-10-01', 4000);
    const book = dayBook(s.db, { from: '2026-10-01', to: '2026-10-01' });
    expect(book.map((r) => r.isCancelled)).toEqual([false, true, false]);

    const summary = daySummary(s.db, { date: '2026-10-01' });
    expect(summary.byType).toEqual([
      { voucherType: 'receipt', count: 1, totalPaise: 4000 },
      { voucherType: 'sales', count: 1, totalPaise: 11800 },
    ]);
    expect(summary.cancelledCount).toBe(1);
    expect(summary.cashInPaise).toBe(4000);
    expect(summary.cashClosingPaise).toBe(5000);
  });
});

describe('outstanding', () => {
  it('matches receipts against the oldest bills and ages what is left', () => {
    const s = seedShop();
    sale(s, '2026-06-01', 10000); // 118.00
    sale(s, '2026-09-01', 20000); // 236.00
    receipt(s, '2026-09-10', 15000);
    const [party] = outstanding(s.db, { asOn: '2026-10-01', side: 'receivable' });
    expect(party!.accountName).toBe('AYAPPAN PIPE KUTTALAM');
    expect(party!.outstandingPaise).toBe(11800 + 23600 - 15000);
    expect(party!.bills.map((b) => b.amountPaise)).toEqual([20400]); // 236.00 less the 32.00 left over from the 150.00 receipt
    expect(party!.bills[0]!.ageDays).toBe(30);
  });

  it('equals the ledger balance and treats an early payment as an advance', () => {
    const s = seedShop();
    receipt(s, '2026-05-01', 3000);
    sale(s, '2026-06-01', 10000);
    const [party] = outstanding(s.db, { asOn: '2026-10-01', side: 'receivable' });
    expect(party!.outstandingPaise).toBe(11800 - 3000);
    expect(party!.advancePaise).toBe(0);
    receipt(s, '2026-07-01', 20000);
    const [after] = outstanding(s.db, { asOn: '2026-10-01', side: 'receivable' });
    expect(after!.outstandingPaise).toBe(0);
    expect(after!.advancePaise).toBe(20000 - 8800); // 200.00 paid against 88.00 still owed
  });

  it('reports payables for suppliers separately', () => {
    const s = seedShop();
    s.db.exec('UPDATE account SET group_id = 14 WHERE id = 12'); // Sundry Creditors
    postVoucher(s.db, {
      type: 'purchase',
      seriesId: s.seriesId.purchase,
      date: '2026-09-01',
      partyAccountId: s.partyB,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    });
    expect(outstanding(s.db, { asOn: '2026-10-01', side: 'receivable' })).toEqual([]);
    const [supplier] = outstanding(s.db, { asOn: '2026-10-01', side: 'payable' });
    expect(supplier!.accountName).toBe('SELVAM TRADERS');
    expect(supplier!.outstandingPaise).toBe(11800);
  });
});

describe('registers', () => {
  it('nets returns and excludes cancelled vouchers from totals', () => {
    const s = seedShop();
    const first = sale(s, '2026-10-01', 10000);
    sale(s, '2026-10-02', 20000);
    postVoucher(s.db, {
      type: 'sales_return',
      seriesId: s.seriesId.sales_return,
      date: '2026-10-03',
      partyAccountId: s.partyA,
      refVoucherId: first.voucherId,
      taxMode: 'local',
      roundOff: false,
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    });
    const gone = sale(s, '2026-10-04', 5000);
    cancelVoucher(s.db, gone.voucherId);

    const reg = salesRegister(s.db, FY);
    expect(reg.rows).toHaveLength(4);
    expect(reg.totals.taxablePaise).toBe(10000 + 20000 - 10000);
    expect(reg.totals.totalPaise).toBe(11800 + 23600 - 11800);
    expect(registerToCsv(reg)).toContain('Cancelled');
    expect(purchaseRegister(s.db, FY).rows).toEqual([]);
  });
});
