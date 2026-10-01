import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { postVoucher } from '../../src/domain/posting/post.ts';
import { previewItemVoucher } from '../../src/domain/posting/preview.ts';
import type { ItemVoucherInput } from '../../src/domain/posting/types.ts';
import { accountBalance } from '../../src/reports/ledger.ts';
import { searchItems } from '../../src/masters/items.ts';
import { seedShop, type Shop } from '../helpers/shop.ts';

const bill = (s: Shop, over: Partial<ItemVoucherInput> = {}): ItemVoucherInput => ({
  type: 'sales',
  seriesId: s.seriesId.sales,
  date: '2026-10-01',
  partyAccountId: s.partyA,
  taxMode: 'local',
  lines: [{ itemId: 1, qty: 2000, unitId: 1, listPricePaise: 10000, discBp: 500 }],
  ...over,
});

describe('previewItemVoucher', () => {
  it('matches what posting produces, line by line and in total', () => {
    const s = seedShop();
    const input = bill(s, {
      lines: [
        { itemId: 1, qty: 3000, unitId: 1, listPricePaise: 9999, discBp: 1250 },
        { itemId: 2, qty: 127050, unitId: 2, listPricePaise: 1234 },
      ],
      sundries: [
        { billSundryId: s.sundry.discount, amountPaise: 5000 },
        { billSundryId: s.sundry.freight, amountPaise: 2500 },
        { billSundryId: s.sundry.packing, amountPaise: 1000 },
      ],
    });
    const preview = previewItemVoucher(s.db, input);
    const posted = postVoucher(s.db, input);
    expect(preview.problems.filter((p) => p.kind === 'error')).toEqual([]);
    expect(preview.totalPaise).toBe(posted.totalPaise);
    const stored = s.db
      .prepare('SELECT amount_paise, taxable_paise, cgst_paise FROM voucher_item ORDER BY line_no')
      .all();
    preview.lines.forEach((l, i) => {
      expect(l!.amountPaise).toBe(Number(stored[i]!['amount_paise']));
      expect(l!.taxablePaise).toBe(Number(stored[i]!['taxable_paise']));
      expect(l!.cgstPaise).toBe(Number(stored[i]!['cgst_paise']));
    });
    expect(preview.taxTable.map((r) => r.rateBp)).toEqual([1800]);
  });

  it('agrees with posting for any bill (500 random bills)', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            itemId: fc.constantFrom(1, 2, 3),
            n: fc.integer({ min: 1, max: 40 }),
            price: fc.integer({ min: 100, max: 900000 }),
            disc: fc.integer({ min: 0, max: 5000 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        fc.constantFrom('local' as const, 'interstate' as const, 'exempt' as const),
        fc.boolean(),
        (rows, taxMode, roundOff) => {
          const s = seedShop();
          const input = bill(s, {
            taxMode,
            roundOff,
            lines: rows.map((r) => ({
              itemId: r.itemId,
              unitId: r.itemId === 2 ? 2 : 1,
              qty: r.itemId === 2 ? r.n * 37 : r.n * 1000,
              listPricePaise: r.price,
              discBp: r.disc,
            })),
          });
          const preview = previewItemVoucher(s.db, input);
          try {
            expect(postVoucher(s.db, input).totalPaise).toBe(preview.totalPaise);
          } catch {
            // a bill that cannot be posted (for example a zero total) must be flagged by the preview
            expect(preview.problems.some((p) => p.kind === 'error')).toBe(true);
          }
        },
      ),
      { numRuns: 500 },
    );
  });

  it('skips unfinished lines, and never throws on an empty bill', () => {
    const s = seedShop();
    const preview = previewItemVoucher(
      s.db,
      bill(s, {
        lines: [
          { itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 },
          { itemId: 0, qty: 0, unitId: 1, listPricePaise: 0 },
        ],
      }),
    );
    expect(preview.lines[1]).toBeNull();
    expect(preview.totalPaise).toBe(11800);
    expect(previewItemVoucher(s.db, bill(s, { lines: [] })).totalPaise).toBe(0);
  });

  it('explains what blocks a bill and what only deserves a warning', () => {
    const s = seedShop();
    s.db.exec("INSERT INTO item (id, name, group_id, unit_id) VALUES (9, 'NEW ITEM', 1, 1)");
    const p = previewItemVoucher(
      s.db,
      bill(s, { lines: [{ itemId: 9, qty: 1000, unitId: 1, listPricePaise: 100 }] }),
    );
    expect(p.problems.map((x) => x.message)).toEqual([
      '"NEW ITEM" has no GST rate. Please set one in Items.',
      '"NEW ITEM" needs an HSN code (4 to 8 digits). Please add it in Items.',
      'Only 0 of "NEW ITEM" is in stock.',
    ]);
    expect(p.problems.map((x) => x.kind)).toEqual(['error', 'error', 'warning']);
  });
});

describe('accountBalance and item cost', () => {
  it('gives the signed balance on a date', () => {
    const s = seedShop();
    s.db.exec('UPDATE account SET opening_balance_paise = 5000, opening_is_dr = 1 WHERE id = 11');
    postVoucher(s.db, bill(s));
    expect(accountBalance(s.db, s.partyA, '2026-09-30')).toBe(5000);
    expect(accountBalance(s.db, s.partyA, '2026-10-01')).toBeGreaterThan(5000);
    expect(accountBalance(s.db, 999, '2026-10-01')).toBe(0);
  });

  it('shows the latest purchase price as the cost, falling back to the opening rate', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET opening_rate_paise = 7000 WHERE id = 1');
    expect(searchItems(s.db, 'clamp')[0]!.costPaise).toBe(7000);
    postVoucher(s.db, {
      type: 'purchase',
      seriesId: s.seriesId.purchase,
      date: '2026-10-01',
      partyAccountId: s.partyB,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 8100 }],
    });
    expect(searchItems(s.db, 'clamp')[0]!.costPaise).toBe(8100);
  });
});
