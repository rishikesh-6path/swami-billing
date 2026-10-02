import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../src/domain/posting/post.ts';
import { partySummary } from '../src/reports/party-summary.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

const sale = (s: Shop, date: string, qty = 1000) =>
  postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date,
    partyAccountId: s.partyA,
    taxMode: 'local',
    roundOff: false,
    lines: [{ itemId: 1, qty, unitId: 1, listPricePaise: 10000 }], // 100.00 + 18% per unit
  });
const receipt = (s: Shop, date: string, amount: number) =>
  postVoucher(s.db, {
    type: 'receipt',
    seriesId: s.seriesId.receipt,
    date,
    partyAccountId: s.partyA,
    entries: [
      { accountId: s.cash, side: 'dr', amountPaise: amount },
      { accountId: s.partyA, side: 'cr', amountPaise: amount },
    ],
  });

describe('party summary', () => {
  it('shows the balance, the part that is late, the oldest late bill and the latest activity', () => {
    const s = seedShop();
    s.db.exec('UPDATE account SET credit_days = 30 WHERE id = 11');
    sale(s, '2026-08-01'); // 118.00, long overdue by 15 Oct
    sale(s, '2026-10-10'); // 118.00, within 30 days
    receipt(s, '2026-10-12', 5000); // 50.00 against the oldest bill
    const sum = partySummary(s.db, s.partyA, '2026-10-15');
    expect(sum).toMatchObject({
      name: 'AYAPPAN PIPE KUTTALAM',
      kind: 'customer',
      balancePaise: 23600 - 5000,
      outstandingPaise: 23600 - 5000,
      advancePaise: 0,
      overduePaise: 11800 - 5000,
    });
    expect(sum.oldestOverdue).toMatchObject({ amountPaise: 6800, ageDays: 75 });
    expect(sum.recentBills.map((b) => b.date)).toEqual(['2026-10-10', '2026-08-01']);
    expect(sum.recentPayments).toEqual([
      expect.objectContaining({ voucherType: 'receipt', amountPaise: 5000, date: '2026-10-12' }),
    ]);
  });

  it('ignores cancelled bills, limits the lists to five, and works for a supplier', () => {
    const s = seedShop();
    const ids = Array.from({ length: 7 }, (_, i) => sale(s, `2026-10-0${i + 1}`).voucherId);
    cancelVoucher(s.db, ids[6]!);
    const sum = partySummary(s.db, s.partyA, '2026-10-15');
    expect(sum.recentBills).toHaveLength(5);
    expect(sum.recentBills[0]?.date).toBe('2026-10-06');
    expect(sum.balancePaise).toBe(6 * 11800);

    const supplier = partySummary(s.db, s.partyB, '2026-10-15');
    expect(supplier.balancePaise).toBe(0);
  });

  it('refuses accounts that are not customers or suppliers', () => {
    const s = seedShop();
    expect(() => partySummary(s.db, s.cash, '2026-10-15')).toThrow(/customers and suppliers only/);
    expect(() => partySummary(s.db, 9999, '2026-10-15')).toThrow(/no longer exists/);
  });

  it('applies a credit note to the bill it corrects, so an old unpaid bill still shows as late', () => {
    const s = seedShop();
    s.db.exec('UPDATE account SET credit_days = 30 WHERE id = 11');
    sale(s, '2026-06-01'); // 118.00
    const newer = sale(s, '2026-10-10'); // 118.00
    postVoucher(s.db, {
      type: 'credit_note',
      seriesId: s.seriesId.credit_note,
      date: '2026-10-12',
      partyAccountId: s.partyA,
      refVoucherId: newer.voucherId,
      taxMode: 'local',
      roundOff: false,
      narration: 'Whole bill taken back',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    });
    const sum = partySummary(s.db, s.partyA, '2026-10-15');
    expect(sum.balancePaise).toBe(11800);
    expect(sum.overduePaise).toBe(11800); // the June bill, untouched
    expect(sum.oldestOverdue).toMatchObject({
      label: expect.stringContaining('Sales') as string,
      ageDays: 136,
    });
    expect(sum.recentBills[0]).toMatchObject({ voucherType: 'credit_note', amountPaise: -11800 });
  });

  it('does not call a refund a payment received, and names it for what it is', () => {
    const s = seedShop();
    s.db.exec('UPDATE account SET credit_days = 0 WHERE id = 11');
    postVoucher(s.db, {
      type: 'payment',
      seriesId: s.seriesId.payment,
      date: '2026-10-05',
      partyAccountId: s.partyA,
      entries: [
        { accountId: s.partyA, side: 'dr', amountPaise: 5000 },
        { accountId: s.cash, side: 'cr', amountPaise: 5000 },
      ],
    });
    receipt(s, '2026-10-12', 3000);
    const sum = partySummary(s.db, s.partyA, '2026-10-15');
    expect(sum.recentPayments.map((p) => p.voucherType)).toEqual(['receipt']);
    expect(sum.oldestOverdue?.label).toMatch(/^Payment/);
  });
});
