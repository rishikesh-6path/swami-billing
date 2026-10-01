import { describe, expect, it } from 'vitest';
import { closeDay, dayClosedThrough, lockBooks, reopenDay } from '../src/books/control.ts';
import { closeFinancialYear } from '../src/books/financial-year.ts';
import { updateAccount } from '../src/masters/accounts.ts';
import { updateItem } from '../src/masters/items.ts';
import { seedShop } from './helpers/shop.ts';

describe('review: day close and books lock', () => {
  it('reopenDay(date) with a date later than the closed day must not extend the closed period', () => {
    const s = seedShop();
    closeDay(s.db, '2026-10-10');
    reopenDay(s.db, '2026-10-20'); // "reopen days after 20 Oct" must not close 11..20 Oct
    const through = dayClosedThrough(s.db);
    expect(through === undefined || through <= '2026-10-10').toBe(true);
  });

  it('closeDay and lockBooks reject calendar-impossible dates (they only match the YYYY-MM-DD shape)', () => {
    const s = seedShop();
    expect(() => closeDay(s.db, '2026-13-45')).toThrow();
    expect(() => lockBooks(s.db, '2026-99-99')).toThrow();
  });

  it('changing an account opening balance is refused once the books are locked (it rewrites every locked ledger balance)', () => {
    const s = seedShop();
    lockBooks(s.db, '2026-10-31');
    expect(() => updateAccount(s.db, s.partyA, { openingBalancePaise: 123_456 })).toThrow();
  });

  it('changing an item opening quantity is refused once the books are locked (it rewrites locked stock reports)', () => {
    const s = seedShop();
    lockBooks(s.db, '2026-10-31');
    expect(() => updateItem(s.db, s.items[0]!, { openingQty: 999_000 })).toThrow();
  });

  it('changing an opening balance is refused after the financial year is closed', () => {
    const s = seedShop();
    closeFinancialYear(s.db, s.fyId);
    expect(() => updateAccount(s.db, s.partyA, { openingBalancePaise: 123_456 })).toThrow();
  });
});
