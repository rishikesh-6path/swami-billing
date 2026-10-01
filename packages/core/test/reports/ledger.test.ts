import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../../src/domain/posting/post.ts';
import { toCsv } from '../../src/reports/csv.ts';
import { accountLedger, ledgerToCsv } from '../../src/reports/ledger.ts';
import { seedShop, type Shop } from '../helpers/shop.ts';

function sale(s: Shop, date: string, amountPaise: number) {
  return postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date,
    partyAccountId: s.partyA,
    taxMode: 'exempt',
    roundOff: false,
    lines: [{ itemId: 3, qty: 1000, unitId: 1, listPricePaise: amountPaise }],
  });
}

function receipt(s: Shop, date: string, amountPaise: number) {
  return postVoucher(s.db, {
    type: 'receipt',
    seriesId: s.seriesId.receipt,
    date,
    partyAccountId: s.partyA,
    entries: [
      { accountId: s.cash, side: 'dr', amountPaise },
      { accountId: s.partyA, side: 'cr', amountPaise },
    ],
  });
}

describe('accountLedger', () => {
  it('shows opening, running balance and closing recomputed from the journal', () => {
    const s = seedShop();
    s.db.exec('UPDATE account SET opening_balance_paise = 100000, opening_is_dr = 1 WHERE id = 11');
    sale(s, '2026-10-01', 50000);
    receipt(s, '2026-10-02', 30000);
    const l = accountLedger(s.db, { accountId: s.partyA, from: '2026-04-01', to: '2027-03-31' });

    expect(l.openingPaise).toBe(100000);
    expect(l.rows.map((r) => r.balancePaise)).toEqual([150000, 120000]);
    expect(l.rows.map((r) => r.particulars)).toEqual(['Sales', 'Cash']);
    expect(l.closingPaise).toBe(l.openingPaise + l.totalDrPaise - l.totalCrPaise);
    expect(l.closingPaise).toBe(120000);
  });

  it('carries earlier movement into the opening balance of a later period', () => {
    const s = seedShop();
    sale(s, '2026-05-01', 50000);
    sale(s, '2026-10-01', 20000);
    const l = accountLedger(s.db, { accountId: s.partyA, from: '2026-10-01', to: '2026-10-31' });
    expect(l.openingPaise).toBe(50000);
    expect(l.closingPaise).toBe(70000);
    expect(l.rows).toHaveLength(1);
  });

  it('hides cancelled vouchers without changing the balance', () => {
    const s = seedShop();
    const keep = sale(s, '2026-10-01', 50000);
    const gone = sale(s, '2026-10-02', 20000);
    cancelVoucher(s.db, gone.voucherId);
    const l = accountLedger(s.db, { accountId: s.partyA, from: '2026-04-01', to: '2027-03-31' });
    expect(l.rows.map((r) => r.voucherId)).toEqual([keep.voucherId]);
    expect(l.closingPaise).toBe(50000);
  });

  it('renders Busy-style Dr/Cr balances in normalised CSV', () => {
    const s = seedShop();
    sale(s, '2026-10-01', 236500);
    const csv = ledgerToCsv(
      accountLedger(s.db, { accountId: s.partyA, from: '2026-04-01', to: '2027-03-31' }),
    );
    expect(csv).toBe(
      [
        'Date,Type,Number,Particulars,Debit,Credit,Balance',
        ',,,Opening Balance,,,0.00',
        '2026-10-01,sales,1,Sales,2365.00,,2365.00 Dr',
        ',,,Closing Balance,2365.00,,2365.00 Dr',
        '',
      ].join('\n'),
    );
  });
});

describe('toCsv', () => {
  it('quotes cells containing commas, quotes and newlines', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"']])).toBe('a,b\n"x,y","say ""hi"""\n');
  });
});
