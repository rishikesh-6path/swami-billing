import { describe, expect, it } from 'vitest';
import { postVoucher } from '../src/domain/posting/post.ts';
import { collectionList, collectionToCsv, outstanding, updateAccount } from '../src/index.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

const sale = (s: Shop, party: number, date: string, price: number) =>
  postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date,
    partyAccountId: party,
    taxMode: 'local',
    roundOff: false,
    lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: price }],
  });
const receipt = (s: Shop, party: number, date: string, amount: number) =>
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

describe('money to collect', () => {
  it('lists only customers with late money, largest first, with the oldest bill and last payment', () => {
    const s = seedShop();
    sale(s, s.partyA, '2026-08-01', 10000); // 118.00, 75 days old on 15-10
    sale(s, s.partyA, '2026-10-10', 10000); // recent, not late
    receipt(s, s.partyA, '2026-09-01', 5000);
    sale(s, s.partyB, '2026-07-01', 50000); // 590.00, very late
    const list = collectionList(s.db, { asOn: '2026-10-15' });
    expect(list.map((r) => r.accountId)).toEqual([s.partyB, s.partyA]);
    const a = list[1]!;
    expect(a.latePaise).toBe(11800 - 5000);
    expect(a.duePaise).toBe(11800 - 5000 + 11800);
    expect(a.oldestLate?.ageDays).toBe(75);
    expect(a.lastPayment).toEqual({ date: '2026-09-01', amountPaise: 5000 });
    expect(list[0]!.lastPayment).toBeNull();
    // the totals due agree with the outstanding report
    const due = outstanding(s.db, { asOn: '2026-10-15', side: 'receivable' });
    expect(a.duePaise).toBe(due.find((d) => d.accountId === s.partyA)!.outstandingPaise);
  });

  it('uses the customer credit days when given, and leaves out customers who are not late', () => {
    const s = seedShop();
    sale(s, s.partyA, '2026-09-01', 10000); // 44 days old
    expect(collectionList(s.db, { asOn: '2026-10-15' })).toHaveLength(1);
    updateAccount(s.db, s.partyA, { creditDays: 60 });
    expect(collectionList(s.db, { asOn: '2026-10-15' })).toEqual([]);
    expect(collectionList(s.db, { asOn: '2026-11-15' })).toHaveLength(1);
  });

  it('saves as a spreadsheet with a total row', () => {
    const s = seedShop();
    sale(s, s.partyB, '2026-07-01', 50000);
    const csv = collectionToCsv(collectionList(s.db, { asOn: '2026-10-15' }));
    expect(csv.split('\n')[0]).toBe(
      'Customer,Phone,Late,Total due,Oldest late bill,Bill date,Days,Last paid on,Last paid',
    );
    expect(csv).toContain('Total,,590.00,590.00');
  });
});
