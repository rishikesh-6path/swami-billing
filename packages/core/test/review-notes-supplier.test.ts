import { describe, expect, it } from 'vitest';
import { postVoucher } from '../src/domain/posting/post.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

const purchase = (s: Shop, over: object = {}) => ({
  type: 'purchase' as const,
  seriesId: s.seriesId.purchase,
  date: '2026-10-10',
  partyAccountId: s.partyB,
  taxMode: 'local' as const,
  lines: [{ itemId: 1, qty: 5000, unitId: 1, listPricePaise: 3000 }],
  ...over,
});

describe('review: supplier invoice duplicate check', () => {
  it('treats the supplier invoice date, not the purchase entry date, as deciding the financial year', () => {
    const s = seedShop();
    s.db.exec(
      `INSERT INTO financial_year (id, start_date, end_date) VALUES (2, '2027-04-01', '2028-03-31')`,
    );
    postVoucher(
      s.db,
      purchase(s, { date: '2027-03-31', partyBillNo: 'INV-5', partyBillDate: '2027-03-30' }),
    );
    // same supplier invoice (dated 30 Mar 2027, FY 2026-27) keyed in again on 2 Apr 2027
    expect(() =>
      postVoucher(
        s.db,
        purchase(s, { date: '2027-04-02', partyBillNo: 'INV-5', partyBillDate: '2027-03-30' }),
      ),
    ).toThrow(/already entered/);
  });
});
