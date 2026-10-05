import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/db/connection.ts';
import {
  accountLedger,
  balanceSheet,
  checkBooks,
  itemSales,
  daySummary,
  gstPurchases,
  gstr1,
  gstSummary,
  listParties,
  listVouchers,
  outstanding,
  partySummary,
  profitAndLoss,
  reorderList,
  searchItems,
  searchParties,
  stockStatus,
  trialBalance,
} from '../src/index.ts';
import { buildBigShop } from './helpers/big-shop.ts';

// A shop with thousands of bills, items and customers. The limit is many times what a normal PC
// needs, so a slow machine does not fail it, but a missing index or a per-item query loop (the kind
// that once made "Items to Order" take 16 seconds) does.
const LIMIT_MS = 3000;
const P = { from: '2026-04-01', to: '2027-03-31' };
const today = '2026-10-15';

describe('screens stay quick in a big shop', () => {
  let dir = '';
  let db: Db;
  let partyId = 0;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'speed-'));
    db = buildBigShop(dir, { items: 2000, parties: 1000, vouchers: 8000 });
    partyId = Number(
      db.prepare("SELECT id FROM account WHERE name = 'Bulk Party 1'").get()?.['id'],
    );
  }, 120_000);

  afterAll(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const cases: Array<[string, () => unknown]> = [
    ['home summary', () => daySummary(db, { date: today })],
    ['money to collect', () => outstanding(db, { asOn: today, side: 'receivable' })],
    ['stock problems', () => stockStatus(db, { asOn: today, onlyProblems: true })],
    ['item search', () => searchItems(db, 'bulk item 12', { onDate: today })],
    [
      'party search',
      () => searchParties(db, { text: 'bulk party 1', kind: 'customer', asOn: today }),
    ],
    ['party list', () => listParties(db, { kind: 'customer', asOn: today })],
    ['bill list', () => listVouchers(db, {})],
    ['trial balance', () => trialBalance(db, P)],
    ['balance sheet', () => balanceSheet(db, { asOn: today })],
    ['profit and loss', () => profitAndLoss(db, P)],
    ['gst summary', () => gstSummary(db, P)],
    ['gstr1', () => gstr1(db, P)],
    ['purchases for the CA', () => gstPurchases(db, P)],
    ['items to order', () => reorderList(db, { asOn: today })],
    ['customer page', () => partySummary(db, partyId, today)],
    ['customer ledger', () => accountLedger(db, { accountId: partyId, ...P })],
    ['check my books', () => checkBooks(db)],
    ['what sold', () => itemSales(db, P)],
  ];

  it.each(cases)('%s', (_name, run) => {
    const start = performance.now();
    run();
    expect(performance.now() - start).toBeLessThan(LIMIT_MS);
  });
});
