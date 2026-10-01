import { describe, expect, it } from 'vitest';
import { listParties } from '../../src/masters/accounts.ts';
import { listItems } from '../../src/masters/items.ts';
import { seedShop } from '../helpers/shop.ts';

describe('listItems', () => {
  it('filters by name or code and shows the GST rate in force', () => {
    const s = seedShop();
    expect(listItems(s.db, { text: 'clamp' }).map((i) => i.name)).toEqual(['GI CLAMP']);
    expect(listItems(s.db, { text: '8450' }).map((i) => i.name)).toEqual(['FINOLEX PIPE']);
    expect(listItems(s.db, { text: '%' })).toEqual([]);
    expect(listItems(s.db).find((i) => i.name === 'GI CLAMP')!.rateBp).toBe(1800);
  });
});

describe('listParties', () => {
  it('lists customers and suppliers separately with balances', () => {
    const s = seedShop();
    s.db.exec(
      'UPDATE account SET group_id = 14, opening_balance_paise = 700, opening_is_dr = 0 WHERE id = 12',
    );
    const customers = listParties(s.db, { kind: 'customer', asOn: '2026-10-01' });
    const suppliers = listParties(s.db, { kind: 'supplier', asOn: '2026-10-01' });
    expect(customers.map((c) => c.name)).toEqual(['AYAPPAN PIPE KUTTALAM']);
    expect(suppliers.map((c) => [c.name, c.balancePaise])).toEqual([['SELVAM TRADERS', -700]]);
    expect(listParties(s.db, { kind: 'all', text: 'selv', asOn: '2026-10-01' })).toHaveLength(1);
  });
});
