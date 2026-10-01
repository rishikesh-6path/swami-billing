import { describe, expect, it } from 'vitest';
import { searchAccounts } from '../../src/masters/accounts.ts';
import { seedShop } from '../helpers/shop.ts';

describe('searchAccounts', () => {
  it('filters cash/bank and other accounts and ranks exact names first', () => {
    const s = seedShop();
    const names = (text: string, kind: 'any' | 'cash_bank' | 'other') =>
      searchAccounts(s.db, { text, kind, asOn: '2026-10-01' }).map((a) => a.name);
    expect(names('', 'cash_bank')).toEqual(['Cash', 'GPAY SELVAM']);
    expect(names('gpay', 'any')).toEqual(['GPAY SELVAM']);
    expect(names('sales', 'other')).toContain('Sales');
    expect(names('sales', 'cash_bank')).toEqual([]);
    expect(names('Cash', 'any')[0]).toBe('Cash');
    expect(
      searchAccounts(s.db, { text: 'cash', kind: 'any', asOn: '2026-10-01' })[0],
    ).toMatchObject({ isCashOrBank: true, groupName: 'Cash-in-Hand' });
  });
});
