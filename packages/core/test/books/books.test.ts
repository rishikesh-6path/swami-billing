import { describe, expect, it } from 'vitest';
import {
  assertDateOpen,
  booksLockedThrough,
  closeDay,
  dayClosedThrough,
  lockBooks,
  reopenDay,
  unlockBooks,
} from '../../src/books/control.ts';
import {
  closeFinancialYear,
  createFinancialYear,
  ensureFinancialYearFor,
  financialYearOn,
  listFinancialYears,
  reopenFinancialYear,
} from '../../src/books/financial-year.ts';
import { cancelVoucher, postVoucher } from '../../src/domain/posting/post.ts';
import { count, seedShop, type Shop } from '../helpers/shop.ts';

const receipt = (s: Shop, date: string, role?: 'owner' | 'staff') =>
  postVoucher(
    s.db,
    {
      type: 'receipt',
      seriesId: s.seriesId.receipt,
      date,
      entries: [
        { accountId: s.cash, side: 'dr', amountPaise: 100 },
        { accountId: s.partyA, side: 'cr', amountPaise: 100 },
      ],
    },
    role ? { role } : {},
  );

describe('financial years', () => {
  it('creates a year from its starting calendar year, once', () => {
    const s = seedShop();
    const id = createFinancialYear(s.db, 2027);
    expect(createFinancialYear(s.db, 2027)).toBe(id);
    expect(financialYearOn(s.db, '2028-03-31')).toMatchObject({
      startDate: '2027-04-01',
      label: '2027-28',
    });
    expect(() => createFinancialYear(s.db, 1999)).toThrow(/valid year/);
  });

  it('ensureFinancialYearFor picks April to March correctly', () => {
    const s = seedShop();
    expect(ensureFinancialYearFor(s.db, '2027-02-10').startDate).toBe('2026-04-01');
    expect(ensureFinancialYearFor(s.db, '2027-04-01').startDate).toBe('2027-04-01');
    expect(listFinancialYears(s.db)).toHaveLength(2);
  });

  it('closing a year locks it, creates the next, and restarts voucher numbers', () => {
    const s = seedShop();
    expect(receipt(s, '2027-03-30').number).toBe(1);
    expect(receipt(s, '2027-03-31').number).toBe(2);
    const { next } = closeFinancialYear(s.db, s.fyId);
    expect(next.startDate).toBe('2027-04-01');
    expect(() => receipt(s, '2027-03-31')).toThrow(/closed/);
    expect(receipt(s, '2027-04-01').number).toBe(1);
    expect(() => closeFinancialYear(s.db, s.fyId)).toThrow(/already closed/);
  });

  it('can reopen a closed year, with an audit row', () => {
    const s = seedShop();
    closeFinancialYear(s.db, s.fyId);
    reopenFinancialYear(s.db, s.fyId, { userId: undefined });
    expect(() => receipt(s, '2027-03-31')).not.toThrow();
    expect(
      count(
        s.db,
        "SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('close_year', 'reopen_year')",
      ),
    ).toBe(2);
  });

  it('refuses to close a year with unfinished bills', () => {
    const s = seedShop();
    const id = receipt(s, '2026-10-01').voucherId;
    s.db.exec(`UPDATE voucher SET status = 'draft' WHERE id = ${id}`);
    expect(() => closeFinancialYear(s.db, s.fyId)).toThrow(/unfinished bills/);
  });
});

describe('day close', () => {
  it('stops staff, but not the owner, from posting or cancelling on a closed day', () => {
    const s = seedShop();
    const old = receipt(s, '2026-10-01');
    closeDay(s.db, '2026-10-01');
    expect(dayClosedThrough(s.db)).toBe('2026-10-01');
    expect(() => receipt(s, '2026-10-01', 'staff')).toThrow(/closed by the owner/);
    expect(() => receipt(s, '2026-09-30', 'staff')).toThrow(/closed by the owner/);
    expect(() => cancelVoucher(s.db, old.voucherId, { role: 'staff' })).toThrow(
      /closed by the owner/,
    );
    expect(() => receipt(s, '2026-10-02', 'staff')).not.toThrow();
    expect(() => receipt(s, '2026-10-01', 'owner')).not.toThrow();
    expect(() => cancelVoucher(s.db, old.voucherId, { role: 'owner' })).not.toThrow();
  });

  it('can be reopened, and cannot be moved backwards without reopening', () => {
    const s = seedShop();
    closeDay(s.db, '2026-10-10');
    expect(() => closeDay(s.db, '2026-10-05')).toThrow(/Reopen it first/);
    reopenDay(s.db, '2026-10-05');
    expect(dayClosedThrough(s.db)).toBe('2026-10-05');
    reopenDay(s.db, null);
    expect(dayClosedThrough(s.db)).toBeUndefined();
    expect(() => receipt(s, '2026-10-01', 'staff')).not.toThrow();
  });
});

describe('books lock (after a GST return is filed)', () => {
  it('blocks everyone, including the owner, up to the lock date', () => {
    const s = seedShop();
    const filed = receipt(s, '2026-10-15');
    lockBooks(s.db, '2026-10-31');
    expect(booksLockedThrough(s.db)).toBe('2026-10-31');
    expect(() => receipt(s, '2026-10-31')).toThrow(/locked up to 31-10-2026/);
    expect(() => cancelVoucher(s.db, filed.voucherId)).toThrow(/Sales Return/);
    expect(() => receipt(s, '2026-11-01')).not.toThrow();
    unlockBooks(s.db);
    expect(() => receipt(s, '2026-10-31')).not.toThrow();
  });

  it('writes an audit row for every control change', () => {
    const s = seedShop();
    closeDay(s.db, '2026-10-01');
    reopenDay(s.db, null);
    lockBooks(s.db, '2026-10-31');
    unlockBooks(s.db);
    expect(
      count(
        s.db,
        "SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('close_day','reopen_day','lock_books','unlock_books')",
      ),
    ).toBe(4);
    expect(() => assertDateOpen(s.db, '2026-10-01', 'staff')).not.toThrow();
  });
});
