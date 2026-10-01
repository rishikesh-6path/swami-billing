import { describe, expect, it } from 'vitest';
import { importItemsCsv, importPartiesCsv, parseCsv } from '../src/import/csv.ts';
import { seedDemoShop } from '../src/demo/seed.ts';
import { balanceSheet } from '../src/reports/financials.ts';
import { trialBalance } from '../src/reports/trial-balance.ts';
import { gstSummary } from '../src/reports/gst/summary.ts';
import { stockStatus } from '../src/reports/stock.ts';
import { getAccount, listAccounts } from '../src/masters/accounts.ts';
import { listItems, searchItems } from '../src/masters/items.ts';
import { login } from '../src/users/users.ts';
import { createFinancialYear } from '../src/books/financial-year.ts';
import { freshDb } from './helpers/db.ts';
import { ensureDefaults } from '../src/masters/setup.ts';

describe('parseCsv', () => {
  it('handles quotes, commas, escaped quotes, newlines inside cells, BOM and CRLF', () => {
    const rows = parseCsv('﻿Name,Note\r\n"Clamp, 1/2""","line1\nline2"\r\n\r\nPlain,x\r\n');
    expect(rows).toEqual([
      ['Name', 'Note'],
      ['Clamp, 1/2"', 'line1\nline2'],
      ['Plain', 'x'],
    ]);
  });
  it('detects tab-separated files', () => {
    expect(parseCsv('Name\tCode\nClamp\t15')).toEqual([
      ['Name', 'Code'],
      ['Clamp', '15'],
    ]);
  });
});

describe('importItemsCsv', () => {
  function shop() {
    const db = freshDb();
    ensureDefaults(db);
    return db;
  }

  it('creates items, groups and units from a spreadsheet with any column order and spellings', () => {
    const db = shop();
    const result = importItemsCsv(
      db,
      'Item Name,Code,GST %,Sale Price,Unit,Category,Opening Stock\nGI Clamp,1500,18%,45,Pcs,Fittings,10\nCable,C1,12,12.5,Mtr,Wires,100.5\n',
    );
    expect(result).toEqual({ created: 2, skipped: [] });
    const clamp = searchItems(db, '1500')[0]!;
    expect(clamp).toMatchObject({
      name: 'GI Clamp',
      salePricePaise: 4500,
      rateBp: 1800,
      unitName: 'Pcs',
    });
    const cable = listItems(db).find((i) => i.name === 'Cable')!;
    expect(cable).toMatchObject({
      unitName: 'Mtr',
      unitDecimals: 3,
      openingQty: 100500,
      groupName: 'Wires',
    });
  });

  it('skips bad rows with a plain reason and the spreadsheet row number, keeping the good ones', () => {
    const db = shop();
    const result = importItemsCsv(
      db,
      'Name,Alias,HSN,Sale Price,GST %\nGood,A1,7307,10,18\n,A2,7307,10,18\nDup,A1,7307,10,18\nBadHsn,A3,12,10,18\nBadPrice,A4,7307,1.234,18\nBadRate,A5,7307,10,abc\n',
    );
    expect(result.created).toBe(1);
    expect(result.skipped).toEqual([
      { row: 3, reason: 'Please enter the item name.' },
      { row: 4, reason: 'The code "A1" is already used by another item.' },
      { row: 5, reason: 'The HSN code should be 4 to 8 digits.' },
      { row: 6, reason: 'amount "1.234" has more than 2 decimal places' },
      { row: 7, reason: '"abc" is not a valid GST rate.' },
    ]);
    expect(listItems(db)).toHaveLength(1); // the failed rows left nothing behind
  });

  it('is safe to run twice and explains a missing Name column', () => {
    const db = shop();
    const csv = 'Name,Alias\nClamp,1\n';
    importItemsCsv(db, csv);
    expect(importItemsCsv(db, csv)).toMatchObject({
      created: 0,
      skipped: [{ row: 2, reason: 'An item named "Clamp" already exists.' }],
    });
    expect(() => importItemsCsv(db, 'Alias\n1')).toThrow(/needs a "Name" column/);
    expect(() => importItemsCsv(db, '')).toThrow(/file is empty/);
  });
});

describe('importPartiesCsv', () => {
  it('puts customers under debtors and suppliers under creditors with sensible Dr/Cr defaults', () => {
    const db = freshDb();
    const result = importPartiesCsv(
      db,
      'Name,Type,GSTIN,Phone,Opening Balance\nAyappan,Customer,27AAPFU0939F1ZV,98400 12345,2365\nFinolex,Supplier,,,15000\nOdd,Customer,27AAPFU0939F1ZX,,0\n',
    );
    expect(result.created).toBe(2);
    expect(result.skipped).toMatchObject([{ row: 4 }]);
    const [a, f] = [
      listAccounts(db, { search: 'Ayappan' })[0]!,
      listAccounts(db, { search: 'Finolex' })[0]!,
    ];
    expect(a).toMatchObject({
      groupName: 'Sundry Debtors',
      openingIsDr: true,
      openingBalancePaise: 236500,
      stateCode: '27',
    });
    expect(f).toMatchObject({ groupName: 'Sundry Creditors', openingIsDr: false });
    expect(getAccount(db, a.id)!.phone).toBe('9840012345');
  });
});

describe('seedDemoShop', () => {
  const TODAY = '2026-10-15';

  it('builds a working shop whose books balance', () => {
    const db = freshDb();
    const summary = seedDemoShop(db, { today: TODAY });
    expect(summary.items).toBe(24);
    expect(summary.parties).toBe(8);
    expect(summary.vouchers).toBeGreaterThan(50);
    expect(login(db, 'Owner', '1234').role).toBe('owner');
    expect(login(db, 'Staff', '1111').role).toBe('staff');

    const tb = trialBalance(db, { from: '2026-04-01', to: '2027-03-31' });
    expect(tb.totalDrPaise).toBe(tb.totalCrPaise);
    expect(tb.openingDifferencePaise).toBe(0);
    const sheet = balanceSheet(db, { asOn: TODAY });
    expect(sheet.openingDifferencePaise).toBe(0);
    expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise);
    expect(gstSummary(db, { from: '2026-09-15', to: TODAY }).outputTax.totalPaise).toBeGreaterThan(
      0,
    );
    expect(stockStatus(db, { asOn: TODAY }).rows.length).toBe(24);
  });

  it('still balances in the next financial year, with stock and profit carried forward', () => {
    const db = freshDb();
    seedDemoShop(db, { today: TODAY });
    createFinancialYear(db, 2027);
    const next = trialBalance(db, { from: '2027-04-01', to: '2028-03-31' });
    expect(next.closingDrPaise).toBe(next.closingCrPaise);
    expect(next.openingDifferencePaise).toBe(0);
    expect(next.rows.map((r) => r.accountName)).toEqual(
      expect.arrayContaining(['Stock in hand', 'Profit and loss brought forward']),
    );
    const sales = next.rows.find((r) => r.accountName === 'Sales');
    expect(sales).toBeUndefined(); // income accounts start the new year at zero
  });

  it('is identical on every run and refuses to double-load', () => {
    const a = freshDb();
    const b = freshDb();
    seedDemoShop(a, { today: TODAY });
    seedDemoShop(b, { today: TODAY });
    const total = (db: typeof a) =>
      db.prepare('SELECT COUNT(*) AS n, SUM(total_paise) AS t FROM voucher').get();
    expect(total(a)).toEqual(total(b));
    expect(() => seedDemoShop(a, { today: TODAY })).toThrow(); // masters already exist
  });
});
