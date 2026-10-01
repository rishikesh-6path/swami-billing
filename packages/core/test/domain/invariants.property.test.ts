import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../../src/domain/posting/post.ts';
import {
  PostingError,
  UnbalancedVoucherError,
  type EntryVoucherType,
  type ItemVoucherType,
  type VoucherInput,
} from '../../src/domain/posting/types.ts';
import { trialBalance } from '../../src/reports/trial-balance.ts';
import { count, seedShop, type Shop } from '../helpers/shop.ts';

// KICKOFF section 10: 500 runs normally, 5,000 before a phase tag (FC_RUNS=5000).
const NUM_RUNS = Number(process.env['FC_RUNS'] ?? 500);

const dateArb = fc
  .integer({ min: 0, max: 364 })
  .map((d) => new Date(Date.UTC(2026, 3, 1 + d)).toISOString().slice(0, 10));

const itemCommand = fc.record({
  kind: fc.constant('item' as const),
  type: fc.constantFrom<ItemVoucherType>('sales', 'sales_return', 'purchase', 'purchase_return'),
  taxMode: fc.constantFrom('local' as const, 'interstate' as const, 'exempt' as const),
  date: dateArb,
  party: fc.constantFrom('A', 'B'),
  lines: fc.array(
    fc.record({
      itemId: fc.constantFrom(1, 2, 3),
      qty: fc.integer({ min: 1, max: 200000 }),
      listPricePaise: fc.integer({ min: 100, max: 500000 }),
      discBp: fc.integer({ min: 0, max: 5000 }),
    }),
    { minLength: 1, maxLength: 4 },
  ),
  sundries: fc
    .subarray([1, 2, 3])
    .chain((ids) =>
      fc.tuple(...ids.map((id) => fc.integer({ min: 0, max: 20000 }).map((a) => ({ id, a })))),
    ),
  roundOff: fc.boolean(),
});

const ACCOUNTS = [1, 2, 3, 11, 12, 13, 14];
const entryCommand = fc.record({
  kind: fc.constant('entry' as const),
  type: fc.constantFrom<EntryVoucherType>(
    'receipt',
    'payment',
    'journal',
    'contra',
    'debit_note',
    'credit_note',
  ),
  date: dateArb,
  amount: fc.integer({ min: 1, max: 5_000_000 }),
  split: fc.integer({ min: 0, max: 100 }),
  drAccount: fc.constantFrom(...ACCOUNTS),
  crAccounts: fc.tuple(fc.constantFrom(...ACCOUNTS), fc.constantFrom(...ACCOUNTS)),
  unbalanced: fc.boolean(),
});

const command = fc.oneof(
  { weight: 5, arbitrary: itemCommand },
  { weight: 3, arbitrary: entryCommand },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('cancel' as const), pick: fc.nat(50) }) },
);
function snapshot(db: Shop['db']) {
  return [
    count(db, 'SELECT COUNT(*) AS n FROM voucher'),
    count(db, 'SELECT COUNT(*) AS n FROM journal_line'),
    count(db, 'SELECT COUNT(*) AS n FROM stock_movement'),
    count(db, 'SELECT COALESCE(SUM(last_no), 0) AS n FROM voucher_counter'),
    count(db, 'SELECT COUNT(*) AS n FROM audit_log'),
  ];
}

describe('ledger invariants (KICKOFF section 6)', () => {
  it(`hold after any sequence of postings, rejections and cancellations (${NUM_RUNS} runs)`, () => {
    let attempted = 0;
    let accepted = 0;
    fc.assert(
      fc.property(fc.array(command, { minLength: 1, maxLength: 12 }), (commands) => {
        const shop = seedShop();
        const { db } = shop;
        const live: { id: number; stock: Map<number, number>; journal: string }[] = [];
        let posted = 0;

        for (const c of commands) {
          if (c.kind === 'cancel') {
            const target = live.length === 0 ? undefined : live[c.pick % live.length];
            if (!target) continue;
            cancelVoucher(db, target.id);
            live.splice(live.indexOf(target), 1);
            continue;
          }

          const before = snapshot(db);
          let input: VoucherInput;
          let expectUnbalanced = false;
          if (c.kind === 'item') {
            input = {
              type: c.type,
              seriesId: shop.seriesId[c.type],
              date: c.date,
              partyAccountId: c.party === 'A' ? shop.partyA : shop.partyB,
              taxMode: c.taxMode,
              roundOff: c.roundOff,
              // Metre (item 2) takes 3 decimals; Pcs items take whole numbers only.
              lines: c.lines.map((l) => ({
                ...l,
                unitId: l.itemId === 2 ? 2 : 1,
                qty: l.itemId === 2 ? l.qty : Math.ceil(l.qty / 1000) * 1000,
              })),
              sundries: c.sundries.map((s) => ({ billSundryId: s.id, amountPaise: s.a })),
            };
          } else {
            const first = Math.floor((c.amount * c.split) / 100);
            const crParts = [first, c.amount - first].filter((x) => x > 0);
            const accounts = c.crAccounts.slice(0, crParts.length);
            expectUnbalanced = c.unbalanced;
            input = {
              type: c.type,
              seriesId: shop.seriesId[c.type],
              date: c.date,
              entries: [
                {
                  accountId: c.drAccount,
                  side: 'dr',
                  amountPaise: c.amount + (c.unbalanced ? 1 : 0),
                },
                ...crParts.map((amountPaise, i) => ({
                  accountId: accounts[i]!,
                  side: 'cr' as const,
                  amountPaise,
                })),
              ],
            };
          }

          attempted += 1;
          try {
            const result = postVoucher(db, input, { legacyImport: true });
            accepted += 1;
            expect(expectUnbalanced).toBe(false);
            posted += 1;
            const stock = new Map<number, number>();
            for (const row of db
              .prepare(
                'SELECT item_id, qty_in - qty_out AS net FROM stock_movement WHERE voucher_id = ?',
              )
              .all(result.voucherId)) {
              const item = Number(row['item_id']);
              stock.set(item, (stock.get(item) ?? 0) + Number(row['net']));
            }
            const journal = JSON.stringify(
              db
                .prepare('SELECT * FROM journal_line WHERE voucher_id = ? ORDER BY id')
                .all(result.voucherId),
            );
            live.push({ id: result.voucherId, stock, journal });
          } catch (error) {
            // A rejected voucher must leave no trace at all.
            expect(error).toBeInstanceOf(PostingError);
            if (expectUnbalanced) expect(error).toBeInstanceOf(UnbalancedVoucherError);
            expect(snapshot(db)).toEqual(before);
          }
        }

        // 1. every voucher balances (reversals included) and posted vouchers are non-zero
        const unbalanced = db
          .prepare(
            `SELECT v.id FROM voucher v LEFT JOIN journal_line j ON j.voucher_id = v.id
             GROUP BY v.id HAVING COALESCE(SUM(j.dr_paise), 0) <> COALESCE(SUM(j.cr_paise), 0)
                OR (v.status = 'posted' AND COALESCE(SUM(j.dr_paise), 0) = 0)`,
          )
          .all();
        expect(unbalanced).toEqual([]);
        // 4. trial balance: total debits equal total credits, and vouchers were never deleted
        expect(count(db, 'SELECT SUM(dr_paise) - SUM(cr_paise) AS n FROM journal_line')).toBe(0);
        expect(count(db, 'SELECT COUNT(*) AS n FROM voucher')).toBe(posted);
        // the trial balance reports the same truth: period and closing totals agree
        const tb = trialBalance(db, { from: '2026-04-01', to: '2027-03-31' });
        expect(tb.totalDrPaise).toBe(tb.totalCrPaise);
        expect(tb.closingDrPaise).toBe(tb.closingCrPaise);

        // 2. stock status equals the net of live (non-cancelled) vouchers only
        const expectedStock = new Map<number, number>();
        for (const v of live) {
          for (const [item, net] of v.stock)
            expectedStock.set(item, (expectedStock.get(item) ?? 0) + net);
        }
        for (const item of shop.items) {
          const actual = count(
            db,
            'SELECT COALESCE(SUM(qty_in) - SUM(qty_out), 0) AS n FROM stock_movement WHERE item_id = ?',
            item,
          );
          expect(actual).toBe(expectedStock.get(item) ?? 0);
        }

        // 3. cancelled vouchers: originals untouched, reversals net each account to zero
        const cancelled = db.prepare("SELECT id FROM voucher WHERE status = 'cancelled'").all();
        for (const row of cancelled) {
          const id = Number(row['id']);
          const perAccount = db
            .prepare(
              'SELECT SUM(dr_paise) - SUM(cr_paise) AS net FROM journal_line WHERE voucher_id = ? GROUP BY account_id',
            )
            .all(id);
          expect(perAccount.every((r) => Number(r['net']) === 0)).toBe(true);
          expect(
            count(
              db,
              'SELECT COUNT(*) AS n FROM journal_line WHERE voucher_id = ? AND is_reversal = 1',
              id,
            ),
          ).toBe(
            count(
              db,
              'SELECT COUNT(*) AS n FROM journal_line WHERE voucher_id = ? AND is_reversal = 0',
              id,
            ),
          );
        }
        for (const v of live) {
          const now = JSON.stringify(
            db.prepare('SELECT * FROM journal_line WHERE voucher_id = ? ORDER BY id').all(v.id),
          );
          expect(now).toBe(v.journal);
        }

        // 5. numbers are contiguous within (type, series, fy)
        const groups = db
          .prepare(
            'SELECT voucher_type, series_id, fy_id, COUNT(*) AS n, MIN(number) AS lo, MAX(number) AS hi FROM voucher GROUP BY 1, 2, 3',
          )
          .all();
        for (const g of groups) {
          expect(Number(g['lo'])).toBe(1);
          expect(Number(g['hi'])).toBe(Number(g['n']));
        }
      }),
      { numRuns: NUM_RUNS },
    );
    // guard against a generator that only produces rejected vouchers
    expect(accepted / attempted).toBeGreaterThan(0.6);
  }, 300_000);
});
