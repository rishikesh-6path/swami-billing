import { describe, expect, it } from 'vitest';
import { postVoucher } from '../../src/domain/posting/post.ts';
import { ValidationError } from '../../src/errors.ts';
import {
  createAccount,
  createAccountGroup,
  deleteAccount,
  getAccount,
  listAccounts,
  updateAccount,
} from '../../src/masters/accounts.ts';
import {
  createItem,
  createItemGroup,
  deleteItem,
  getItem,
  searchItems,
  setItemTaxRate,
  taxRateHistory,
  updateItem,
} from '../../src/masters/items.ts';
import {
  addBroker,
  createBillSundry,
  createSaleType,
  createVoucherSeries,
  defaultSeriesId,
  ensureDefaults,
  listBillSundries,
  listBrokers,
  listSaleTypes,
  listVoucherSeries,
} from '../../src/masters/setup.ts';
import { isValidGstin } from '../../src/masters/validation.ts';
import { count } from '../helpers/shop.ts';
import { freshDb } from '../helpers/db.ts';

const SUNDRY_DEBTORS = 12;

describe('GSTIN validation', () => {
  it('accepts well-formed numbers with a correct check character', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('29AAGCB7383J1Z4')).toBe(true);
  });
  it('rejects a wrong check character, a bad shape and lowercase', () => {
    expect(isValidGstin('27AAPFU0939F1ZX')).toBe(false);
    expect(isValidGstin('27AAPFU0939F1Z')).toBe(false);
    expect(isValidGstin('27aapfu0939f1zv')).toBe(false);
  });
});

describe('accounts', () => {
  it('creates a party with a GSTIN, deriving the state from it', () => {
    const db = freshDb();
    const id = createAccount(db, {
      name: '  Ayappan   Pipe ',
      groupId: SUNDRY_DEBTORS,
      gstin: '27aapfu0939f1zv',
      creditDays: 30,
    });
    expect(getAccount(db, id)).toMatchObject({
      name: 'Ayappan Pipe',
      gstin: '27AAPFU0939F1ZV',
      stateCode: '27',
      creditDays: 30,
    });
    expect(
      count(
        db,
        "SELECT COUNT(*) AS n FROM audit_log WHERE table_name = 'account' AND action = 'create'",
      ),
    ).toBe(1);
  });

  it('explains problems in plain words', () => {
    const db = freshDb();
    const bad = (input: Parameters<typeof createAccount>[1]) => () => createAccount(db, input);
    expect(bad({ name: '', groupId: SUNDRY_DEBTORS })).toThrow(/enter the account name/);
    expect(bad({ name: 'X', groupId: SUNDRY_DEBTORS, gstin: '27AAPFU0939F1ZX' })).toThrow(
      /GST number/,
    );
    expect(
      bad({ name: 'X', groupId: SUNDRY_DEBTORS, gstin: '27AAPFU0939F1ZV', stateCode: '33' }),
    ).toThrow(/state does not match/);
    expect(bad({ name: 'X', groupId: SUNDRY_DEBTORS, phone: 'call me' })).toThrow(/phone number/);
    expect(bad({ name: 'X', groupId: 999 })).toThrow(/choose a group/);
    expect(bad({ name: 'X', groupId: SUNDRY_DEBTORS, openingBalancePaise: -5 })).toThrow(
      /cannot be negative/,
    );
    expect(bad({ name: 'cash', groupId: SUNDRY_DEBTORS })).toThrow(/already exists/); // case-insensitive
    expect(bad({ name: 'cash', groupId: SUNDRY_DEBTORS })).toThrow(ValidationError);
  });

  it('protects built-in accounts and accounts that have entries', () => {
    const db = freshDb();
    expect(() => updateAccount(db, 1, { name: 'Till' })).toThrow(/built-in/);
    expect(() => deleteAccount(db, 1)).toThrow(/built-in/);

    const id = createAccount(db, { name: 'Party', groupId: SUNDRY_DEBTORS });
    db.exec(
      "INSERT INTO financial_year (id, start_date, end_date) VALUES (1, '2026-04-01', '2027-03-31')",
    );
    ensureDefaults(db);
    postVoucher(db, {
      type: 'receipt',
      seriesId: defaultSeriesId(db, 'receipt'),
      date: '2026-10-01',
      entries: [
        { accountId: 1, side: 'dr', amountPaise: 100 },
        { accountId: id, side: 'cr', amountPaise: 100 },
      ],
    });
    expect(() => deleteAccount(db, id)).toThrow(/has entries/);
  });

  it('updates, audits and deletes an unused account; searches by name', () => {
    const db = freshDb();
    const id = createAccount(db, { name: 'Selvam Traders', groupId: SUNDRY_DEBTORS });
    updateAccount(db, id, { phone: '98400 12345', openingBalancePaise: 5000, openingIsDr: false });
    expect(getAccount(db, id)).toMatchObject({
      phone: '9840012345',
      openingBalancePaise: 5000,
      openingIsDr: false,
    });
    expect(listAccounts(db, { search: 'selv' }).map((a) => a.name)).toEqual(['Selvam Traders']);
    expect(listAccounts(db, { search: '%' })).toEqual([]);
    deleteAccount(db, id);
    expect(getAccount(db, id)).toBeUndefined();
    expect(count(db, "SELECT COUNT(*) AS n FROM audit_log WHERE table_name = 'account'")).toBe(3);
  });

  it('adds a sub-group that inherits its parent nature', () => {
    const db = freshDb();
    const id = createAccountGroup(db, { name: 'Local Customers', parentId: SUNDRY_DEBTORS });
    expect(db.prepare('SELECT nature FROM account_group WHERE id = ?').get(id)).toEqual({
      nature: 'asset',
    });
    expect(() =>
      createAccountGroup(db, { name: 'local customers', parentId: SUNDRY_DEBTORS }),
    ).toThrow(/already exists/);
  });
});

describe('items', () => {
  function shop() {
    const db = freshDb();
    ensureDefaults(db);
    const group = createItemGroup(db, { name: 'GI FITTING' });
    return { db, group, pcs: 1, metre: 2 };
  }

  it('creates an item with its first tax rate and keeps a rate history', () => {
    const { db, group, pcs } = shop();
    const id = createItem(db, {
      name: 'GI Clamp',
      alias: '1500',
      groupId: group,
      unitId: pcs,
      hsn: '7307',
      taxRateBp: 2800,
      salePricePaise: 4500,
    });
    setItemTaxRate(db, id, '2025-09-22', 1800);
    expect(taxRateHistory(db, id)).toEqual([
      { effectiveFrom: '2025-09-22', rateBp: 1800 },
      { effectiveFrom: '2017-07-01', rateBp: 2800 },
    ]);
    expect(() => setItemTaxRate(db, id, '2025-09-22', 6000)).toThrow(/between 0% and 50%/);
  });

  it('rejects duplicates, bad HSN and fractional quantity on whole-number units', () => {
    const { db, group, pcs, metre } = shop();
    createItem(db, { name: 'GI Clamp', alias: 'G84', groupId: group, unitId: pcs });
    const create = (over: Partial<Parameters<typeof createItem>[1]>) => () =>
      createItem(db, { name: 'Other', groupId: group, unitId: pcs, ...over });
    expect(create({ name: 'gi clamp' })).toThrow(/already exists/);
    expect(create({ alias: 'g84' })).toThrow(/already used/);
    expect(create({ hsn: '12' })).toThrow(/4 to 8 digits/);
    expect(create({ openingQty: 1500 })).toThrow(/whole number/);
    expect(() =>
      createItem(db, { name: 'Pipe', groupId: group, unitId: metre, openingQty: 1500 }),
    ).not.toThrow();
    expect(create({ openingQty: -897000 })).not.toThrow(); // negative opening stock is allowed
  });

  it('will not change the unit of a billed item or delete it, but can mark it not in use', () => {
    const { db, group, pcs, metre } = shop();
    db.exec(
      "INSERT INTO financial_year (id, start_date, end_date) VALUES (1, '2026-04-01', '2027-03-31')",
    );
    const id = createItem(db, {
      name: 'Clamp',
      groupId: group,
      unitId: pcs,
      taxRateBp: 1800,
      hsn: '7307',
    });
    postVoucher(db, {
      type: 'sales',
      seriesId: defaultSeriesId(db, 'sales'),
      date: '2026-10-01',
      partyAccountId: 1,
      taxMode: 'local',
      lines: [{ itemId: id, qty: 1000, unitId: pcs, listPricePaise: 1000 }],
    });
    expect(() => updateItem(db, id, { unitId: metre })).toThrow(/already been billed/);
    expect(() => deleteItem(db, id)).toThrow(/not in use/);
    updateItem(db, id, { isActive: false });
    expect(getItem(db, id)!.isActive).toBe(false);
    expect(searchItems(db, 'clamp')).toEqual([]);
    expect(searchItems(db, 'clamp', { includeInactive: true })).toHaveLength(1);
  });
});

describe('searchItems (counter lookup)', () => {
  function shop() {
    const db = freshDb();
    ensureDefaults(db);
    const group = createItemGroup(db, { name: 'Plumbing' });
    const add = (name: string, alias?: string) =>
      createItem(db, { name, alias, groupId: group, unitId: 1, taxRateBp: 1800 });
    add('GI CLAMP 1/2', '1500');
    add('1500 WATT HEATER', 'H15');
    add('PVC ELBOW 4"', 'E4');
    add('FINOLEX PIPE 4"', 'P4');
    add('100% COTTON TAPE', 'T1');
    return db;
  }

  it('puts an exact alias match first, then name prefix, then contains', () => {
    const db = shop();
    expect(searchItems(db, '1500').map((r) => r.name)).toEqual([
      'GI CLAMP 1/2',
      '1500 WATT HEATER',
    ]);
    expect(searchItems(db, 'pvc').map((r) => r.name)).toEqual(['PVC ELBOW 4"']);
    expect(searchItems(db, 'pipe').map((r) => r.name)).toEqual(['FINOLEX PIPE 4"']);
  });

  it('matches several words in any order and ignores case', () => {
    const db = shop();
    expect(searchItems(db, '4" finolex').map((r) => r.name)).toEqual(['FINOLEX PIPE 4"']);
    expect(searchItems(db, 'e4').map((r) => r.alias)).toEqual(['E4']);
  });

  it('treats % and _ literally and returns nothing for blank input', () => {
    const db = shop();
    expect(searchItems(db, '100%').map((r) => r.name)).toEqual(['100% COTTON TAPE']);
    expect(searchItems(db, '%')).toHaveLength(1);
    expect(searchItems(db, '   ')).toEqual([]);
  });

  it('returns the tax rate in force on the date and the stock on hand', () => {
    const db = shop();
    const id = searchItems(db, 'e4')[0]!.id;
    setItemTaxRate(db, id, '2027-01-01', 500);
    expect(searchItems(db, 'e4', { onDate: '2026-12-31' })[0]!.rateBp).toBe(1800);
    expect(searchItems(db, 'e4', { onDate: '2027-01-01' })[0]!.rateBp).toBe(500);
    updateItem(db, id, { openingQty: 7000 });
    expect(searchItems(db, 'e4')[0]!.stockQty).toBe(7000);
  });
});

describe('setup masters', () => {
  it('ensureDefaults is idempotent and creates what a first bill needs', () => {
    const db = freshDb();
    ensureDefaults(db);
    const snapshot = [
      count(db, 'SELECT COUNT(*) AS n FROM voucher_series'),
      count(db, 'SELECT COUNT(*) AS n FROM sale_type'),
      count(db, 'SELECT COUNT(*) AS n FROM bill_sundry'),
      count(db, 'SELECT COUNT(*) AS n FROM account'),
      count(db, 'SELECT COUNT(*) AS n FROM unit'),
    ];
    ensureDefaults(db);
    expect([
      count(db, 'SELECT COUNT(*) AS n FROM voucher_series'),
      count(db, 'SELECT COUNT(*) AS n FROM sale_type'),
      count(db, 'SELECT COUNT(*) AS n FROM bill_sundry'),
      count(db, 'SELECT COUNT(*) AS n FROM account'),
      count(db, 'SELECT COUNT(*) AS n FROM unit'),
    ]).toEqual(snapshot);
    expect(
      listSaleTypes(db)
        .map((s) => s.taxMode)
        .sort(),
    ).toEqual(['exempt', 'interstate', 'local']);
    expect(listVoucherSeries(db, 'sales')).toHaveLength(1);
  });

  it('creates the account behind a bill sundry automatically', () => {
    const db = freshDb();
    const id = createBillSundry(db, { name: 'Loading Charges', adds: true, affectsTaxable: true });
    const sundry = listBillSundries(db).find((s) => s.id === id)!;
    expect(sundry.sign).toBe(1);
    expect(getAccount(db, sundry.accountId)).toMatchObject({
      name: 'Loading Charges',
      groupName: 'Indirect Incomes',
    });
    expect(() =>
      createBillSundry(db, { name: 'loading charges', adds: true, affectsTaxable: true }),
    ).toThrow(/already exists/);
  });

  it('manages series, sale types and brokers', () => {
    const db = freshDb();
    ensureDefaults(db);
    createVoucherSeries(db, { voucherType: 'sales', name: 'Wholesale', prefix: 'W-' });
    expect(() => createVoucherSeries(db, { voucherType: 'sales', name: 'wholesale' })).toThrow(
      /already exists/,
    );
    expect(() =>
      createVoucherSeries(db, { voucherType: 'sales', name: 'X', prefix: 'TOO-LONG-PREFIX' }),
    ).toThrow(/10 characters/);
    createSaleType(db, { name: 'Export', taxMode: 'exempt' });
    expect(() => createSaleType(db, { name: 'export', taxMode: 'exempt' })).toThrow(
      /already exists/,
    );
    addBroker(db, 'OFFICE');
    addBroker(db, 'office');
    addBroker(db, 'Murugan');
    expect(listBrokers(db)).toEqual(['Murugan', 'OFFICE']);
  });
});
