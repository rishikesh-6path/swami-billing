import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../src/domain/posting/post.ts';
import { checkBooks, seedDemoShop } from '../src/index.ts';
import { freshDb } from './helpers/db.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

function withBills(): { s: Shop; saleId: number } {
  const s = seedShop();
  const sale = postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date: '2026-10-05',
    partyAccountId: s.partyA,
    taxMode: 'local',
    lines: [{ itemId: 1, qty: 2000, unitId: 1, listPricePaise: 10000 }],
    sundries: [{ billSundryId: s.sundry.packing, amountPaise: 1000 }],
  });
  cancelVoucher(
    s.db,
    postVoucher(s.db, {
      type: 'sales',
      seriesId: s.seriesId.sales,
      date: '2026-10-06',
      partyAccountId: s.partyA,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    }).voucherId,
  );
  return { s, saleId: sale.voucherId };
}
const failing = (s: Shop) =>
  checkBooks(s.db)
    .checks.filter((c) => !c.ok)
    .map((c) => c.title);

describe('check my books', () => {
  it('finds nothing wrong in healthy books, including the demo shop', () => {
    expect(failing(withBills().s)).toEqual([]);
    const demo = freshDb();
    seedDemoShop(demo, { today: '2026-10-15' });
    const health = checkBooks(demo);
    expect(health.ok).toBe(true);
    expect(health.checks.length).toBeGreaterThanOrEqual(8);
  });

  it('finds an entry that does not balance, and names the bill', () => {
    const { s, saleId } = withBills();
    s.db
      .prepare(
        'INSERT INTO journal_line (voucher_id, account_id, dr_paise, cr_paise, line_no) VALUES (?, ?, 100, 0, 99)',
      )
      .run(saleId, s.cash);
    const health = checkBooks(s.db);
    expect(health.ok).toBe(false);
    const found = health.checks.find((c) => c.title === 'Every entry balances')!;
    expect(found.ok).toBe(false);
    expect(found.message).toBe('1 bill does not balance.');
    expect(found.examples[0]).toMatch(/^Sales/);
  });

  it('finds a bill total that does not match its lines', () => {
    const { s, saleId } = withBills();
    s.db.prepare('UPDATE voucher SET total_paise = total_paise + 1 WHERE id = ?').run(saleId);
    expect(failing(s)).toEqual(['Bill totals match their lines']);
  });

  it('finds stock that does not follow a bill', () => {
    const { s, saleId } = withBills();
    s.db
      .prepare(
        "INSERT INTO stock_movement (voucher_id, item_id, qty_in, qty_out, rate_paise, date) VALUES (?, 1, 0, 1000, 0, '2026-10-05')",
      )
      .run(saleId);
    expect(failing(s)).toEqual(['Stock follows the bills']);
  });

  it('finds a gap in the bill numbers', () => {
    const { s } = withBills();
    s.db.exec("UPDATE voucher_counter SET last_no = last_no + 1 WHERE voucher_type = 'sales'");
    expect(failing(s)).toEqual(['Bill numbers have no gaps']);
  });

  it('finds a cancelled bill that still counts', () => {
    const { s } = withBills();
    const cancelled = Number(
      s.db.prepare("SELECT id FROM voucher WHERE status = 'cancelled'").get()?.['id'],
    );
    s.db
      .prepare(
        'INSERT INTO journal_line (voucher_id, account_id, dr_paise, cr_paise, line_no) VALUES (?, ?, 50, 0, 98), (?, ?, 0, 50, 99)',
      )
      .run(cancelled, s.cash, cancelled, s.partyA);
    expect(failing(s)).toEqual(['Cancelled bills are fully undone']);
  });
});
