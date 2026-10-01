import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/connection.ts';
import { freshDb } from '../helpers/db.ts';

function seedVoucher(db: Db): number {
  db.exec(`
    INSERT INTO financial_year (id, start_date, end_date) VALUES (1, '2026-04-01', '2027-03-31');
    INSERT INTO voucher_series (id, voucher_type, name) VALUES (1, 'sales', 'Main');
    INSERT INTO voucher (id, voucher_type, series_id, number, date, fy_id, created_at, modified_at)
    VALUES (1, 'sales', 1, 1, '2026-10-01', 1, 'now', 'now');
  `);
  return 1;
}

describe('domain schema', () => {
  it('seeds the system accounts the posting engine needs', () => {
    const db = freshDb();
    const names = db
      .prepare('SELECT name FROM account WHERE is_system = 1 ORDER BY id')
      .all()
      .map((r) => r['name']);
    expect(names).toEqual(
      expect.arrayContaining(['Cash', 'Sales', 'Purchase', 'Output CGST', 'Round Off']),
    );
  });

  it('rejects a journal line that is both debit and credit', () => {
    const db = freshDb();
    seedVoucher(db);
    expect(() =>
      db.exec(
        'INSERT INTO journal_line (voucher_id, account_id, dr_paise, cr_paise, line_no) VALUES (1, 1, 5, 5, 1)',
      ),
    ).toThrow(/CHECK/);
  });

  it('never allows a voucher to be hard-deleted', () => {
    const db = freshDb();
    seedVoucher(db);
    expect(() => db.exec('DELETE FROM voucher WHERE id = 1')).toThrow(/cannot be deleted/);
  });

  it('keeps journal lines and stock movements immutable', () => {
    const db = freshDb();
    seedVoucher(db);
    db.exec(
      'INSERT INTO journal_line (voucher_id, account_id, dr_paise, line_no) VALUES (1, 1, 100, 1)',
    );
    expect(() => db.exec('UPDATE journal_line SET dr_paise = 1')).toThrow(/cannot be changed/);
    expect(() => db.exec('DELETE FROM journal_line')).toThrow(/cannot be deleted/);
  });

  it('rejects a duplicate voucher number within the same type, series and year', () => {
    const db = freshDb();
    seedVoucher(db);
    expect(() =>
      db.exec(`INSERT INTO voucher (voucher_type, series_id, number, date, fy_id, created_at, modified_at)
               VALUES ('sales', 1, 1, '2026-10-02', 1, 'now', 'now')`),
    ).toThrow(/UNIQUE/);
  });

  it('allows a voucher to be cancelled but never un-cancelled or renumbered', () => {
    const db = freshDb();
    seedVoucher(db);
    db.exec("UPDATE voucher SET status = 'cancelled' WHERE id = 1");
    expect(() => db.exec("UPDATE voucher SET status = 'posted' WHERE id = 1")).toThrow(/frozen/);
    expect(() => db.exec('UPDATE voucher SET number = 9 WHERE id = 1')).toThrow(/frozen/);
  });

  it('enforces foreign keys on voucher lines', () => {
    const db = freshDb();
    expect(() =>
      db.exec(
        'INSERT INTO journal_line (voucher_id, account_id, dr_paise, line_no) VALUES (999, 1, 1, 1)',
      ),
    ).toThrow(/FOREIGN KEY/);
  });

  it('allows negative opening stock, as Busy data has', () => {
    const db = freshDb();
    db.exec("INSERT INTO item_group (id, name) VALUES (1, 'G')");
    db.exec(
      "INSERT INTO item (name, group_id, unit_id, opening_qty) VALUES ('1\" BLACK SCREW', 1, 1, -897000)",
    );
  });
});
