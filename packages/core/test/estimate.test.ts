import { describe, expect, it } from 'vitest';
import { postVoucher } from '../src/domain/posting/post.ts';
import {
  buildEstimate,
  recordEstimate,
  renderEstimate,
  ValidationError,
  type Company,
} from '../src/index.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

const company: Company = {
  name: 'Swami <Hardware>',
  address: 'Main Road',
  stateCode: '29',
  gstin: null,
  phone: null,
  invoiceFooter: 'Thank you',
};

const draft = (s: Shop, over: object = {}) => ({
  type: 'sales' as const,
  seriesId: s.seriesId.sales,
  date: '2026-10-05',
  partyAccountId: s.partyA,
  taxMode: 'local' as const,
  lines: [
    { itemId: 1, qty: 3000, unitId: 1, listPricePaise: 4500, discBp: 500 },
    { itemId: 0, qty: 0, unitId: 0, listPricePaise: 0 }, // a blank row on the screen
  ],
  sundries: [{ billSundryId: s.sundry.freight, amountPaise: 2000 }],
  ...over,
});

describe('estimate', () => {
  it('has the same lines and total the bill would have, and saves nothing', () => {
    const s = seedShop();
    const e = buildEstimate(s.db, draft(s));
    expect(e.lines).toHaveLength(1);
    const count = () => Number(s.db.prepare('SELECT COUNT(*) AS n FROM voucher').get()?.['n']);
    expect(count()).toBe(0);
    const real = draft(s);
    const posted = postVoucher(s.db, { ...real, lines: [real.lines[0]!] });
    expect(e.totalPaise).toBe(posted.totalPaise);
    expect(e.sundries).toEqual([
      expect.objectContaining({ name: 'Freight & Forwarding', sign: 1, amountPaise: 2000 }),
    ]);
  });

  it('says it is not a bill, has no number, escapes names and is recorded', () => {
    const s = seedShop();
    const shown = renderEstimate(s.db, draft(s), company, 'a4');
    const { html } = shown;
    expect(html).toContain('ESTIMATE');
    expect(html).toContain('not a bill. Prices are offered until 12-10-2026.');
    expect(html).toContain('Swami &lt;Hardware&gt;');
    expect(html).not.toContain('No.:');
    const audits = () =>
      Number(
        s.db
          .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'estimate_printed'")
          .get()?.['n'],
      );
    // only shown so far: nothing recorded until it is printed or saved
    expect(audits()).toBe(0);
    recordEstimate(s.db, { userId: undefined }, shown);
    expect(audits()).toBe(1);
    expect(renderEstimate(s.db, draft(s), company, 'thermal').html).toContain('ESTIMATE');
  });

  it('does not name the shared Cash customer, and refuses an estimate with no items', () => {
    const s = seedShop();
    expect(buildEstimate(s.db, draft(s, { partyAccountId: s.cash })).party).toBeNull();
    expect(() =>
      buildEstimate(
        s.db,
        draft(s, { lines: [{ itemId: 0, qty: 0, unitId: 0, listPricePaise: 0 }] }),
      ),
    ).toThrow(ValidationError);
  });

  it('refuses rather than quote a wrong price', () => {
    const s = seedShop();
    // a picked item without a quantity
    expect(() =>
      buildEstimate(
        s.db,
        draft(s, { lines: [{ itemId: 1, qty: 0, unitId: 1, listPricePaise: 4500 }] }),
      ),
    ).toThrow(/Row 1: please enter the quantity/);
    // half a piece of an item sold in whole units
    expect(() =>
      buildEstimate(
        s.db,
        draft(s, { lines: [{ itemId: 1, qty: 1500, unitId: 1, listPricePaise: 4500 }] }),
      ),
    ).toThrow(/whole units/);
    // an item with no GST rate would be quoted without GST
    s.db.exec('DELETE FROM item_tax_rate WHERE item_id = 1');
    expect(() => buildEstimate(s.db, draft(s))).toThrow(/no GST rate/);
  });

  it('gives the reason when the figures cannot be worked out', () => {
    const s = seedShop();
    expect(() =>
      buildEstimate(
        s.db,
        draft(s, { sundries: [{ billSundryId: s.sundry.discount, amountPaise: 99_999_999 }] }),
      ),
    ).toThrow(ValidationError);
    expect(() =>
      buildEstimate(
        s.db,
        draft(s, { sundries: [{ billSundryId: s.sundry.discount, amountPaise: 99_999_999 }] }),
      ),
    ).not.toThrow(/at least one item/);
  });
});
