import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../src/domain/posting/post.ts';
import { lastPriceFor } from '../src/masters/last-price.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

const sale = (s: Shop, date: string, price: number, party = s.partyA, discBp = 0) =>
  postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date,
    partyAccountId: party,
    taxMode: 'local',
    lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: price, discBp }],
  });

describe('last price', () => {
  it('is the newest posted sale of that item to that customer', () => {
    const s = seedShop();
    sale(s, '2026-09-01', 4000);
    sale(s, '2026-10-01', 4500, s.partyA, 500);
    sale(s, '2026-10-05', 9999, s.partyB); // another customer
    expect(lastPriceFor(s.db, { partyId: s.partyA, itemId: 1, type: 'sales' })).toEqual({
      listPricePaise: 4500,
      discBp: 500,
      date: '2026-10-01',
    });
  });

  it('skips cancelled bills, other items and other bill kinds, and can look back from a date', () => {
    const s = seedShop();
    sale(s, '2026-09-01', 4000);
    const newer = sale(s, '2026-10-01', 4500);
    cancelVoucher(s.db, newer.voucherId);
    expect(
      lastPriceFor(s.db, { partyId: s.partyA, itemId: 1, type: 'sales' })?.listPricePaise,
    ).toBe(4000);
    expect(lastPriceFor(s.db, { partyId: s.partyA, itemId: 2, type: 'sales' })).toBeNull();
    expect(lastPriceFor(s.db, { partyId: s.partyA, itemId: 1, type: 'purchase' })).toBeNull();
    expect(
      lastPriceFor(s.db, { partyId: s.partyA, itemId: 1, type: 'sales', before: '2026-08-01' }),
    ).toBeNull();
  });
});
