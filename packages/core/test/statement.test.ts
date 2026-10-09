import { describe, expect, it } from 'vitest';
import { postVoucher } from '../src/domain/posting/post.ts';
import { accountBalance, renderStatement, updateAccount, type Company } from '../src/index.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

const company: Company = {
  name: 'Swami Hardware',
  address: 'Main Road',
  stateCode: '29',
  gstin: null,
  phone: null,
  invoiceFooter: 'Thank you',
};
const sale = (s: Shop, date: string, price: number) =>
  postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date,
    partyAccountId: s.partyA,
    taxMode: 'local',
    roundOff: false,
    lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: price }],
  });

describe('statement of account', () => {
  it('ends on the same balance as the books and says it is due', () => {
    const s = seedShop();
    sale(s, '2026-06-01', 10000); // 118.00, old
    sale(s, '2026-10-01', 20000); // 236.00
    postVoucher(s.db, {
      type: 'receipt',
      seriesId: s.seriesId.receipt,
      date: '2026-10-03',
      partyAccountId: s.partyA,
      entries: [
        { accountId: s.cash, side: 'dr', amountPaise: 5000 },
        { accountId: s.partyA, side: 'cr', amountPaise: 5000 },
      ],
    });
    const r = renderStatement(
      s.db,
      { partyId: s.partyA, from: '2026-04-01', to: '2026-10-31' },
      company,
    );
    expect(r.closingPaise).toBe(accountBalance(s.db, s.partyA, '2026-10-31'));
    expect(r.closingPaise).toBe(11800 + 23600 - 5000);
    expect(r.html).toContain('STATEMENT OF ACCOUNT');
    expect(r.html).toContain('Amount due: ₹ 304.00');
    expect(r.html).toContain('Unpaid bills by age');
    // the ageing adds up to what is still unpaid
    expect(r.html).toContain('<td>304.00</td></tr></tbody></table>');
  });

  it('shows an advance as an advance, escapes names, and starts from the right balance', () => {
    const s = seedShop();
    updateAccount(s.db, s.partyA, { name: 'Ravi <& Sons>' });
    postVoucher(s.db, {
      type: 'receipt',
      seriesId: s.seriesId.receipt,
      date: '2026-05-03',
      partyAccountId: s.partyA,
      entries: [
        { accountId: s.cash, side: 'dr', amountPaise: 5000 },
        { accountId: s.partyA, side: 'cr', amountPaise: 5000 },
      ],
    });
    const r = renderStatement(
      s.db,
      { partyId: s.partyA, from: '2026-10-01', to: '2026-10-31' },
      company,
    );
    expect(r.html).toContain('Ravi &lt;&amp; Sons&gt;');
    expect(r.html).toContain('Advance with us: ₹ 50.00');
    expect(r.html).toContain('Balance at the start</td><td class="n">50.00 Cr');
    expect(r.html).not.toContain('Unpaid bills by age');
  });
});
