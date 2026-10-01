import { writeAudit, type Ctx } from '../audit.ts';
import { transaction, type Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import type { TaxMode, VoucherType } from '../domain/posting/types.ts';
import { getSetting, setSetting } from '../settings.ts';
import { requireName } from './validation.ts';

export const VOUCHER_TYPE_LABELS: Record<VoucherType, string> = {
  sales: 'Sales',
  sales_return: 'Sales Return',
  purchase: 'Purchase',
  purchase_return: 'Purchase Return',
  receipt: 'Receipt',
  payment: 'Payment',
  journal: 'Journal',
  contra: 'Contra',
  debit_note: 'Debit Note',
  credit_note: 'Credit Note',
};

export interface SaleTypeRow {
  id: number;
  name: string;
  taxMode: TaxMode;
}
export interface BillSundryRow {
  id: number;
  name: string;
  sign: 1 | -1;
  affectsTaxable: boolean;
  accountId: number;
}
export interface SeriesRow {
  id: number;
  voucherType: VoucherType;
  name: string;
  prefix: string;
}

export function listSaleTypes(db: Db): SaleTypeRow[] {
  return db
    .prepare('SELECT id, name, tax_mode FROM sale_type ORDER BY name')
    .all()
    .map((r) => ({
      id: Number(r['id']),
      name: String(r['name']),
      taxMode: String(r['tax_mode']) as TaxMode,
    }));
}

export function createSaleType(
  db: Db,
  input: { name: string; taxMode: TaxMode },
  ctx: Ctx = {},
): number {
  const name = requireName(input.name, 'sale type name');
  return transaction(db, () => {
    if (db.prepare('SELECT 1 FROM sale_type WHERE lower(name) = lower(?)').get(name)) {
      throw new ValidationError(`A sale type named "${name}" already exists.`);
    }
    const id = Number(
      db.prepare('INSERT INTO sale_type (name, tax_mode) VALUES (?, ?)').run(name, input.taxMode)
        .lastInsertRowid,
    );
    writeAudit(db, ctx, {
      action: 'create',
      table: 'sale_type',
      rowId: id,
      after: { name, taxMode: input.taxMode },
    });
    return id;
  });
}

export function listBillSundries(db: Db): BillSundryRow[] {
  return db
    .prepare('SELECT id, name, sign, affects_taxable, account_id FROM bill_sundry ORDER BY name')
    .all()
    .map((r) => ({
      id: Number(r['id']),
      name: String(r['name']),
      sign: Number(r['sign']) as 1 | -1,
      affectsTaxable: Boolean(r['affects_taxable']),
      accountId: Number(r['account_id']),
    }));
}

/**
 * Creates a bill sundry (extra charge or discount). Its own account is created automatically:
 * charges are other income, discounts are expenses, so nobody has to know account groups.
 */
export function createBillSundry(
  db: Db,
  input: { name: string; adds: boolean; affectsTaxable: boolean },
  ctx: Ctx = {},
): number {
  const name = requireName(input.name, 'name');
  return transaction(db, () => {
    if (db.prepare('SELECT 1 FROM bill_sundry WHERE lower(name) = lower(?)').get(name)) {
      throw new ValidationError(`"${name}" already exists.`);
    }
    const groupName = input.adds ? 'Indirect Incomes' : 'Indirect Expenses';
    const group = db.prepare('SELECT id FROM account_group WHERE name = ?').get(groupName);
    if (!group)
      throw new ValidationError('The account groups are missing. Please contact support.');
    let account = db.prepare('SELECT id FROM account WHERE lower(name) = lower(?)').get(name);
    if (!account) {
      db.prepare('INSERT INTO account (name, group_id) VALUES (?, ?)').run(
        name,
        Number(group['id']),
      );
      account = db.prepare('SELECT id FROM account WHERE name = ?').get(name);
    }
    const id = Number(
      db
        .prepare(
          'INSERT INTO bill_sundry (name, sign, affects_taxable, account_id) VALUES (?, ?, ?, ?)',
        )
        .run(name, input.adds ? 1 : -1, input.affectsTaxable ? 1 : 0, Number(account?.['id']))
        .lastInsertRowid,
    );
    writeAudit(db, ctx, {
      action: 'create',
      table: 'bill_sundry',
      rowId: id,
      after: { ...input, name },
    });
    return id;
  });
}

export function listVoucherSeries(db: Db, voucherType?: VoucherType): SeriesRow[] {
  return db
    .prepare(
      'SELECT id, voucher_type, name, prefix FROM voucher_series WHERE (? IS NULL OR voucher_type = ?) ORDER BY voucher_type, name',
    )
    .all(voucherType ?? null, voucherType ?? null)
    .map((r) => ({
      id: Number(r['id']),
      voucherType: String(r['voucher_type']) as VoucherType,
      name: String(r['name']),
      prefix: String(r['prefix']),
    }));
}

export function createVoucherSeries(
  db: Db,
  input: { voucherType: VoucherType; name: string; prefix?: string },
  ctx: Ctx = {},
): number {
  const name = requireName(input.name, 'series name');
  const prefix = (input.prefix ?? '').trim();
  if (prefix.length > 10) throw new ValidationError('The prefix can be at most 10 characters.');
  return transaction(db, () => {
    if (
      db
        .prepare('SELECT 1 FROM voucher_series WHERE voucher_type = ? AND lower(name) = lower(?)')
        .get(input.voucherType, name)
    ) {
      throw new ValidationError(
        `A ${VOUCHER_TYPE_LABELS[input.voucherType]} series named "${name}" already exists.`,
      );
    }
    const id = Number(
      db
        .prepare('INSERT INTO voucher_series (voucher_type, name, prefix) VALUES (?, ?, ?)')
        .run(input.voucherType, name, prefix).lastInsertRowid,
    );
    writeAudit(db, ctx, {
      action: 'create',
      table: 'voucher_series',
      rowId: id,
      after: { ...input, name, prefix },
    });
    return id;
  });
}

/** The first series of a type, used when a screen does not ask which series to use. */
export function defaultSeriesId(db: Db, voucherType: VoucherType): number {
  const row = db
    .prepare('SELECT id FROM voucher_series WHERE voucher_type = ? ORDER BY id LIMIT 1')
    .get(voucherType);
  if (!row)
    throw new ValidationError(`There is no ${VOUCHER_TYPE_LABELS[voucherType]} number series yet.`);
  return Number(row['id']);
}

export function listBrokers(db: Db): string[] {
  try {
    const parsed: unknown = JSON.parse(getSetting(db, 'brokers') ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((b): b is string => typeof b === 'string') : [];
  } catch {
    return [];
  }
}

export function addBroker(db: Db, name: string): void {
  const clean = requireName(name, 'broker name');
  const brokers = listBrokers(db);
  if (!brokers.some((b) => b.toLowerCase() === clean.toLowerCase())) {
    setSetting(db, 'brokers', JSON.stringify([...brokers, clean].sort()));
  }
}

/**
 * Creates everything a new shop needs before its first bill: units, an item group, a "Main"
 * number series per voucher type, sale types and the usual bill sundries. Safe to run again.
 */
export function ensureDefaults(db: Db): void {
  transaction(db, () => {
    const units: [string, number][] = [
      ['Kg', 3],
      ['Ltr', 3],
      ['Feet', 3],
      ['Box', 0],
      ['Set', 0],
      ['Pair', 0],
      ['Roll', 0],
      ['Bag', 0],
    ];
    for (const [name, decimals] of units) {
      db.prepare('INSERT OR IGNORE INTO unit (name, decimals) VALUES (?, ?)').run(name, decimals);
    }
    if (!db.prepare('SELECT 1 FROM item_group LIMIT 1').get()) {
      db.prepare("INSERT INTO item_group (name) VALUES ('General')").run();
    }
    for (const type of Object.keys(VOUCHER_TYPE_LABELS) as VoucherType[]) {
      db.prepare(
        "INSERT OR IGNORE INTO voucher_series (voucher_type, name, prefix) VALUES (?, 'Main', '')",
      ).run(type);
    }
    for (const [name, mode] of [
      ['Local', 'local'],
      ['Interstate', 'interstate'],
      ['Exempt', 'exempt'],
    ] as const) {
      db.prepare('INSERT OR IGNORE INTO sale_type (name, tax_mode) VALUES (?, ?)').run(name, mode);
    }
    const sundries: { name: string; adds: boolean; affectsTaxable: boolean }[] = [
      { name: 'Discount', adds: false, affectsTaxable: true },
      { name: 'Freight & Forwarding', adds: true, affectsTaxable: true },
      { name: 'Packing', adds: true, affectsTaxable: false },
    ];
    for (const s of sundries) {
      if (!db.prepare('SELECT 1 FROM bill_sundry WHERE name = ?').get(s.name))
        createBillSundry(db, s);
    }
  });
}
