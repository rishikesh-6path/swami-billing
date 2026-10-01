import type { SQLOutputValue } from 'node:sqlite';
import { writeAudit, type Ctx } from '../audit.ts';
import { transaction, type Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';

export interface FinancialYearRow {
  id: number;
  startDate: string;
  endDate: string;
  isLocked: boolean;
  label: string;
}

const row = (r: Record<string, SQLOutputValue>): FinancialYearRow => {
  const startDate = String(r['start_date']);
  const endDate = String(r['end_date']);
  return {
    id: Number(r['id']),
    startDate,
    endDate,
    isLocked: Boolean(r['is_locked']),
    label: `${startDate.slice(0, 4)}-${endDate.slice(2, 4)}`,
  };
};

export function listFinancialYears(db: Db): FinancialYearRow[] {
  return db.prepare('SELECT * FROM financial_year ORDER BY start_date').all().map(row);
}

export function financialYearOn(db: Db, date: string): FinancialYearRow | undefined {
  const found = db
    .prepare('SELECT * FROM financial_year WHERE start_date <= ? AND end_date >= ?')
    .get(date, date);
  return found ? row(found) : undefined;
}

/** The financial year starting on 1 April of `startYear` (so 2026 gives 2026-04-01 to 2027-03-31). */
export function createFinancialYear(db: Db, startYear: number, ctx: Ctx = {}): number {
  if (!Number.isInteger(startYear) || startYear < 2017 || startYear > 2100) {
    throw new ValidationError('Please enter a valid year.');
  }
  const start = `${startYear}-04-01`;
  const end = `${startYear + 1}-03-31`;
  return transaction(db, () => {
    const existing = db.prepare('SELECT id FROM financial_year WHERE start_date = ?').get(start);
    if (existing) return Number(existing['id']);
    const id = Number(
      db.prepare('INSERT INTO financial_year (start_date, end_date) VALUES (?, ?)').run(start, end)
        .lastInsertRowid,
    );
    writeAudit(db, ctx, {
      action: 'create',
      table: 'financial_year',
      rowId: id,
      after: { start, end },
    });
    return id;
  });
}

/** First-run helper: makes sure the year containing `today` exists. Safe to call every start. */
export function ensureFinancialYearFor(db: Db, today: string, ctx: Ctx = {}): FinancialYearRow {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  createFinancialYear(db, month >= 4 ? year : year - 1, ctx);
  const found = financialYearOn(db, today);
  if (!found) throw new ValidationError('Could not set up the financial year.');
  return found;
}

/**
 * Finishes a financial year: the next year is created and the finished one is locked so
 * nothing more can be posted to it. Balances and stock carry forward on their own because the
 * books are continuous; voucher numbers start again from 1 in the new year.
 */
export function closeFinancialYear(
  db: Db,
  fyId: number,
  ctx: Ctx = {},
): { next: FinancialYearRow } {
  return transaction(db, () => {
    const fy = db.prepare('SELECT * FROM financial_year WHERE id = ?').get(fyId);
    if (!fy) throw new ValidationError('That financial year does not exist.');
    const current = row(fy);
    if (current.isLocked) throw new ValidationError(`The year ${current.label} is already closed.`);
    const drafts = db
      .prepare("SELECT COUNT(*) AS n FROM voucher WHERE fy_id = ? AND status = 'draft'")
      .get(fyId);
    if (Number(drafts?.['n']) > 0) {
      throw new ValidationError(
        'There are unfinished bills in this year. Please finish or remove them first.',
      );
    }
    const nextId = createFinancialYear(db, Number(current.startDate.slice(0, 4)) + 1, ctx);
    db.prepare('UPDATE financial_year SET is_locked = 1 WHERE id = ?').run(fyId);
    writeAudit(db, ctx, {
      action: 'close_year',
      table: 'financial_year',
      rowId: fyId,
      after: { label: current.label },
    });
    const next = row(db.prepare('SELECT * FROM financial_year WHERE id = ?').get(nextId)!);
    return { next };
  });
}

/** Owner-only escape hatch for fixing a closed year; always audited. */
export function reopenFinancialYear(db: Db, fyId: number, ctx: Ctx = {}): void {
  transaction(db, () => {
    const result = db
      .prepare('UPDATE financial_year SET is_locked = 0 WHERE id = ? AND is_locked = 1')
      .run(fyId);
    if (Number(result.changes) > 0) {
      writeAudit(db, ctx, { action: 'reopen_year', table: 'financial_year', rowId: fyId });
    }
  });
}
