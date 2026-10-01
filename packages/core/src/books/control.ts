import { writeAudit, type Ctx } from '../audit.ts';
import { transaction, type Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import { getSetting, setSetting } from '../settings.ts';

export type Role = 'owner' | 'staff';

const DAY_KEY = 'books.day_closed_through';
const LOCK_KEY = 'books.locked_through';

const iso = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written YYYY-MM-DD (so 2026-02-30 and 2026-13-01 are not). */
function isRealDate(text: string): boolean {
  if (!iso.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

function readDate(db: Db, key: string): string | undefined {
  const value = getSetting(db, key);
  return value && iso.test(value) ? value : undefined;
}

export const dayClosedThrough = (db: Db) => readDate(db, DAY_KEY);
export const booksLockedThrough = (db: Db) => readDate(db, LOCK_KEY);

function pretty(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}-${m}-${y}`;
}

/**
 * Throws if `date` is no longer open for changes. Two controls apply:
 * - books lock (after a GST return is filed): nobody may post, change or cancel up to that date;
 * - day close: the owner closes each day, after which staff cannot change that day or earlier.
 * `role` defaults to owner so internal callers are not blocked by day close.
 */
export function assertDateOpen(db: Db, date: string, role: Role = 'owner'): void {
  const locked = booksLockedThrough(db);
  if (locked !== undefined && date <= locked) {
    throw new ValidationError(
      `The books are locked up to ${pretty(locked)} because returns have been filed. To correct a bill, make a Sales Return or Purchase Return dated today.`,
    );
  }
  const closed = dayClosedThrough(db);
  if (role === 'staff' && closed !== undefined && date <= closed) {
    throw new ValidationError(
      `${pretty(date)} has been closed by the owner. Please ask the owner to make this change.`,
    );
  }
}

/** Owner closes the day: from now on staff cannot change vouchers dated on or before it. */
export function closeDay(db: Db, date: string, ctx: Ctx = {}): void {
  if (!isRealDate(date)) throw new ValidationError('Please choose a valid date.');
  transaction(db, () => {
    const previous = dayClosedThrough(db);
    if (previous !== undefined && date < previous) {
      throw new ValidationError(
        `The day ${pretty(previous)} is already closed. Reopen it first to close an earlier day.`,
      );
    }
    setSetting(db, DAY_KEY, date);
    writeAudit(db, ctx, {
      action: 'close_day',
      table: 'setting',
      rowId: 0,
      before: previous,
      after: date,
    });
  });
}

/** Owner reopens days after `date` (or everything when no date is given). */
export function reopenDay(db: Db, date: string | null, ctx: Ctx = {}): void {
  if (date !== null && !isRealDate(date)) throw new ValidationError('Please choose a valid date.');
  transaction(db, () => {
    const previous = dayClosedThrough(db);
    // reopening can only shorten the closed period, never extend it
    if (date !== null && (previous === undefined || date >= previous)) return;
    setSetting(db, DAY_KEY, date ?? '');
    writeAudit(db, ctx, {
      action: 'reopen_day',
      table: 'setting',
      rowId: 0,
      before: previous,
      after: date,
    });
  });
}

export function lockBooks(db: Db, throughDate: string, ctx: Ctx = {}): void {
  if (!isRealDate(throughDate)) throw new ValidationError('Please choose a valid date.');
  transaction(db, () => {
    const previous = booksLockedThrough(db);
    setSetting(db, LOCK_KEY, throughDate);
    writeAudit(db, ctx, {
      action: 'lock_books',
      table: 'setting',
      rowId: 0,
      before: previous,
      after: throughDate,
    });
  });
}

export function unlockBooks(db: Db, ctx: Ctx = {}): void {
  transaction(db, () => {
    const previous = booksLockedThrough(db);
    setSetting(db, LOCK_KEY, '');
    writeAudit(db, ctx, { action: 'unlock_books', table: 'setting', rowId: 0, before: previous });
  });
}

/**
 * Opening balances and opening stock sit at the very start of the books, so changing them
 * rewrites every ledger and stock figure after it. Once the books are locked or a year has been
 * closed that would silently change figures that may already be filed.
 */
export function assertOpeningsEditable(db: Db): void {
  const locked = booksLockedThrough(db);
  const closedYear = db.prepare('SELECT 1 FROM financial_year WHERE is_locked = 1 LIMIT 1').get();
  if (locked !== undefined || closedYear) {
    throw new ValidationError(
      'Opening balances and opening stock cannot be changed after the books are locked or a year is closed. The owner can unlock the books in Settings first, or you can make a journal entry instead.',
    );
  }
}
