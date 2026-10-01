import type { SQLOutputValue } from 'node:sqlite';
import { writeAudit, type Ctx } from '../audit.ts';
import { transaction, type Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import { requireName, requireNonNegative } from './validation.ts';

/** GST began on 1 July 2017; a rate with no other date applies from then. */
export const DEFAULT_RATE_FROM = '2017-07-01';

type Row = Record<string, SQLOutputValue>;

export interface UnitRow {
  id: number;
  name: string;
  decimals: 0 | 3;
}
export interface ItemGroupRow {
  id: number;
  name: string;
  parentId: number | null;
}
export interface ItemRow {
  id: number;
  name: string;
  alias: string | null;
  groupId: number;
  groupName: string;
  unitId: number;
  unitName: string;
  unitDecimals: number;
  hsn: string | null;
  openingQty: number;
  openingRatePaise: number;
  salePricePaise: number;
  mrpPaise: number;
  minStockQty: number;
  isActive: boolean;
}
export interface ItemSearchRow {
  id: number;
  name: string;
  alias: string | null;
  unitId: number;
  unitName: string;
  unitDecimals: number;
  hsn: string | null;
  salePricePaise: number;
  /** Price on the item's latest purchase bill, or its opening rate if never bought. */
  costPaise: number;
  /** Tax rate in force on the search date, if the item has one. */
  rateBp: number | null;
  stockQty: number;
}

export function listUnits(db: Db): UnitRow[] {
  return db
    .prepare('SELECT id, name, decimals FROM unit ORDER BY name')
    .all()
    .map((r) => ({
      id: Number(r['id']),
      name: String(r['name']),
      decimals: Number(r['decimals']) as 0 | 3,
    }));
}

export function createUnit(
  db: Db,
  input: { name: string; allowDecimals: boolean },
  ctx: Ctx = {},
): number {
  const name = requireName(input.name, 'unit name');
  return transaction(db, () => {
    if (db.prepare('SELECT 1 FROM unit WHERE lower(name) = lower(?)').get(name)) {
      throw new ValidationError(`A unit named "${name}" already exists.`);
    }
    const id = Number(
      db
        .prepare('INSERT INTO unit (name, decimals) VALUES (?, ?)')
        .run(name, input.allowDecimals ? 3 : 0).lastInsertRowid,
    );
    writeAudit(db, ctx, { action: 'create', table: 'unit', rowId: id, after: { name } });
    return id;
  });
}

export function listItemGroups(db: Db): ItemGroupRow[] {
  return db
    .prepare('SELECT id, name, parent_id FROM item_group ORDER BY name')
    .all()
    .map((r) => ({
      id: Number(r['id']),
      name: String(r['name']),
      parentId: r['parent_id'] === null ? null : Number(r['parent_id']),
    }));
}

export function createItemGroup(
  db: Db,
  input: { name: string; parentId?: number | undefined },
  ctx: Ctx = {},
): number {
  const name = requireName(input.name, 'group name');
  return transaction(db, () => {
    const parentId = input.parentId ?? null;
    if (parentId !== null && !db.prepare('SELECT 1 FROM item_group WHERE id = ?').get(parentId)) {
      throw new ValidationError('The parent group no longer exists.');
    }
    if (
      db
        .prepare('SELECT 1 FROM item_group WHERE lower(name) = lower(?) AND parent_id IS ?')
        .get(name, parentId)
    ) {
      throw new ValidationError(`A group named "${name}" already exists here.`);
    }
    const id = Number(
      db.prepare('INSERT INTO item_group (name, parent_id) VALUES (?, ?)').run(name, parentId)
        .lastInsertRowid,
    );
    writeAudit(db, ctx, {
      action: 'create',
      table: 'item_group',
      rowId: id,
      after: { name, parentId },
    });
    return id;
  });
}

const ITEM_SELECT = `SELECT i.*, g.name AS group_name, u.name AS unit_name, u.decimals AS unit_decimals
  FROM item i JOIN item_group g ON g.id = i.group_id JOIN unit u ON u.id = i.unit_id`;

const item = (r: Row): ItemRow => ({
  id: Number(r['id']),
  name: String(r['name']),
  alias: r['alias'] === null ? null : String(r['alias']),
  groupId: Number(r['group_id']),
  groupName: String(r['group_name']),
  unitId: Number(r['unit_id']),
  unitName: String(r['unit_name']),
  unitDecimals: Number(r['unit_decimals']),
  hsn: r['hsn'] === null ? null : String(r['hsn']),
  openingQty: Number(r['opening_qty']),
  openingRatePaise: Number(r['opening_rate_paise']),
  salePricePaise: Number(r['sale_price_paise']),
  mrpPaise: Number(r['mrp_paise']),
  minStockQty: Number(r['min_stock_qty']),
  isActive: Boolean(r['is_active']),
});

export function getItem(db: Db, id: number): ItemRow | undefined {
  const row = db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id);
  return row ? item(row) : undefined;
}

export interface ItemInput {
  name: string;
  alias?: string | null | undefined;
  groupId: number;
  unitId: number;
  hsn?: string | null | undefined;
  openingQty?: number | undefined;
  openingRatePaise?: number | undefined;
  salePricePaise?: number | undefined;
  mrpPaise?: number | undefined;
  minStockQty?: number | undefined;
  /** GST rate in basis points (1800 = 18%). Recorded in the item's rate history. */
  taxRateBp?: number | undefined;
  taxEffectiveFrom?: string | undefined;
}

function cleanHsn(hsn: string | null | undefined): string | null {
  const value = (hsn ?? '').replace(/\s/g, '');
  if (value === '') return null;
  if (!/^\d{4,8}$/.test(value)) throw new ValidationError('The HSN code should be 4 to 8 digits.');
  return value;
}

function cleanRate(rateBp: number): number {
  if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 5000) {
    throw new ValidationError('The GST rate should be between 0% and 50%.');
  }
  return rateBp;
}

function checkQty(db: Db, unitId: number, qty: number, label: string): void {
  const unit = db.prepare('SELECT name, decimals FROM unit WHERE id = ?').get(unitId);
  if (!unit) throw new ValidationError('Please choose a unit.');
  if (Number(unit['decimals']) === 0 && qty % 1000 !== 0) {
    throw new ValidationError(
      `${label} must be a whole number because this item is counted in ${String(unit['name'])}.`,
    );
  }
}

function aliasTaken(db: Db, alias: string, exceptId: number): boolean {
  return (
    db
      .prepare('SELECT 1 FROM item WHERE lower(alias) = lower(?) AND id <> ?')
      .get(alias, exceptId) !== undefined
  );
}

function nameTaken(db: Db, name: string, exceptId: number): boolean {
  return (
    db
      .prepare('SELECT 1 FROM item WHERE lower(name) = lower(?) AND id <> ?')
      .get(name, exceptId) !== undefined
  );
}

export function createItem(db: Db, input: ItemInput, ctx: Ctx = {}): number {
  const name = requireName(input.name, 'item name');
  const alias = (input.alias ?? '').trim() || null;
  const hsn = cleanHsn(input.hsn);
  const prices = {
    openingRate: requireNonNegative(input.openingRatePaise, 'opening rate'),
    sale: requireNonNegative(input.salePricePaise, 'sale price'),
    mrp: requireNonNegative(input.mrpPaise, 'MRP'),
    min: requireNonNegative(input.minStockQty, 'minimum stock'),
  };
  return transaction(db, () => {
    if (!db.prepare('SELECT 1 FROM item_group WHERE id = ?').get(input.groupId)) {
      throw new ValidationError('Please choose a group for this item.');
    }
    checkQty(db, input.unitId, input.openingQty ?? 0, 'The opening quantity');
    checkQty(db, input.unitId, prices.min, 'The minimum stock');
    if (nameTaken(db, name, -1))
      throw new ValidationError(`An item named "${name}" already exists.`);
    if (alias !== null && aliasTaken(db, alias, -1)) {
      throw new ValidationError(`The code "${alias}" is already used by another item.`);
    }
    const id = Number(
      db
        .prepare(
          `INSERT INTO item (name, alias, group_id, unit_id, hsn, opening_qty, opening_rate_paise, sale_price_paise, mrp_paise, min_stock_qty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          name,
          alias,
          input.groupId,
          input.unitId,
          hsn,
          input.openingQty ?? 0,
          prices.openingRate,
          prices.sale,
          prices.mrp,
          prices.min,
        ).lastInsertRowid,
    );
    if (input.taxRateBp !== undefined) {
      db.prepare(
        'INSERT INTO item_tax_rate (item_id, effective_from, rate_bp) VALUES (?, ?, ?)',
      ).run(id, input.taxEffectiveFrom ?? DEFAULT_RATE_FROM, cleanRate(input.taxRateBp));
    }
    writeAudit(db, ctx, { action: 'create', table: 'item', rowId: id, after: getItem(db, id) });
    return id;
  });
}

export function updateItem(
  db: Db,
  id: number,
  patch: Partial<Omit<ItemInput, 'taxRateBp' | 'taxEffectiveFrom'>> & { isActive?: boolean },
  ctx: Ctx = {},
): void {
  transaction(db, () => {
    const before = getItem(db, id);
    if (!before) throw new ValidationError('That item no longer exists.');
    const name = patch.name === undefined ? before.name : requireName(patch.name, 'item name');
    const alias = patch.alias === undefined ? before.alias : (patch.alias ?? '').trim() || null;
    const unitId = patch.unitId ?? before.unitId;
    if (unitId !== before.unitId) {
      const used = db.prepare('SELECT 1 FROM voucher_item WHERE item_id = ? LIMIT 1').get(id);
      if (used)
        throw new ValidationError(
          'The unit cannot be changed because this item has already been billed.',
        );
    }
    const openingQty = patch.openingQty ?? before.openingQty;
    checkQty(db, unitId, openingQty, 'The opening quantity');
    if (nameTaken(db, name, id))
      throw new ValidationError(`An item named "${name}" already exists.`);
    if (alias !== null && aliasTaken(db, alias, id)) {
      throw new ValidationError(`The code "${alias}" is already used by another item.`);
    }
    db.prepare(
      `UPDATE item SET name = ?, alias = ?, group_id = ?, unit_id = ?, hsn = ?, opening_qty = ?, opening_rate_paise = ?,
         sale_price_paise = ?, mrp_paise = ?, min_stock_qty = ?, is_active = ? WHERE id = ?`,
    ).run(
      name,
      alias,
      patch.groupId ?? before.groupId,
      unitId,
      patch.hsn === undefined ? before.hsn : cleanHsn(patch.hsn),
      openingQty,
      requireNonNegative(patch.openingRatePaise ?? before.openingRatePaise, 'opening rate'),
      requireNonNegative(patch.salePricePaise ?? before.salePricePaise, 'sale price'),
      requireNonNegative(patch.mrpPaise ?? before.mrpPaise, 'MRP'),
      requireNonNegative(patch.minStockQty ?? before.minStockQty, 'minimum stock'),
      (patch.isActive ?? before.isActive) ? 1 : 0,
      id,
    );
    writeAudit(db, ctx, {
      action: 'update',
      table: 'item',
      rowId: id,
      before,
      after: getItem(db, id),
    });
  });
}

/** Adds a rate to the item's history. Bills already made keep the rate they were made with. */
export function setItemTaxRate(
  db: Db,
  itemId: number,
  effectiveFrom: string,
  rateBp: number,
  ctx: Ctx = {},
): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom))
    throw new ValidationError('Please enter a valid date.');
  const rate = cleanRate(rateBp);
  transaction(db, () => {
    if (!getItem(db, itemId)) throw new ValidationError('That item no longer exists.');
    db.prepare(
      `INSERT INTO item_tax_rate (item_id, effective_from, rate_bp) VALUES (?, ?, ?)
       ON CONFLICT (item_id, effective_from) DO UPDATE SET rate_bp = excluded.rate_bp`,
    ).run(itemId, effectiveFrom, rate);
    writeAudit(db, ctx, {
      action: 'set_tax_rate',
      table: 'item',
      rowId: itemId,
      after: { effectiveFrom, rateBp: rate },
    });
  });
}

export function taxRateHistory(
  db: Db,
  itemId: number,
): { effectiveFrom: string; rateBp: number }[] {
  return db
    .prepare(
      'SELECT effective_from, rate_bp FROM item_tax_rate WHERE item_id = ? ORDER BY effective_from DESC',
    )
    .all(itemId)
    .map((r) => ({ effectiveFrom: String(r['effective_from']), rateBp: Number(r['rate_bp']) }));
}

/** Only items never used in a voucher can be removed; otherwise mark them inactive. */
export function deleteItem(db: Db, id: number, ctx: Ctx = {}): void {
  transaction(db, () => {
    const before = getItem(db, id);
    if (!before) return;
    if (db.prepare('SELECT 1 FROM voucher_item WHERE item_id = ? LIMIT 1').get(id)) {
      throw new ValidationError(
        `"${before.name}" has already been billed. You can mark it as not in use instead.`,
      );
    }
    db.prepare('DELETE FROM item_tax_rate WHERE item_id = ?').run(id);
    db.prepare('DELETE FROM item WHERE id = ?').run(id);
    writeAudit(db, ctx, { action: 'delete', table: 'item', rowId: id, before });
  });
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Counter lookup (KICKOFF section 7): alias exact first, then name starts with, then alias
 * starts with, then name contains. Several words must all appear. Case does not matter.
 */
export function searchItems(
  db: Db,
  text: string,
  opts: { limit?: number; onDate?: string; includeInactive?: boolean } = {},
): ItemSearchRow[] {
  const query = text.trim().toLowerCase();
  if (query === '') return [];
  const tokens = query.split(/\s+/);
  const date = opts.onDate ?? new Date().toISOString().slice(0, 10);
  const tokenClauses = tokens
    .map(
      () => `(lower(i.name) LIKE ? ESCAPE '\\' OR lower(COALESCE(i.alias, '')) LIKE ? ESCAPE '\\')`,
    )
    .join(' AND ');
  const params: (string | number)[] = [
    date,
    query,
    `${escapeLike(query)}%`,
    `${escapeLike(query)}%`,
    `%${escapeLike(query)}%`,
  ];
  for (const t of tokens) params.push(`%${escapeLike(t)}%`, `%${escapeLike(t)}%`);
  params.push(opts.includeInactive ? 0 : 1, opts.limit ?? 20);

  return db
    .prepare(
      `SELECT i.id, i.name, i.alias, i.unit_id, u.name AS unit_name, u.decimals AS unit_decimals, i.hsn,
              i.sale_price_paise,
              COALESCE((SELECT vi.price_paise FROM voucher_item vi JOIN voucher v ON v.id = vi.voucher_id
                WHERE vi.item_id = i.id AND v.voucher_type = 'purchase' AND v.status = 'posted'
                ORDER BY v.date DESC, v.id DESC LIMIT 1), i.opening_rate_paise) AS cost_paise,
              (SELECT rate_bp FROM item_tax_rate r WHERE r.item_id = i.id AND r.effective_from <= ?
               ORDER BY r.effective_from DESC LIMIT 1) AS rate_bp,
              i.opening_qty + COALESCE((SELECT SUM(m.qty_in) - SUM(m.qty_out) FROM stock_movement m
                JOIN voucher v ON v.id = m.voucher_id WHERE m.item_id = i.id AND v.status = 'posted'), 0) AS stock_qty,
              CASE WHEN lower(i.alias) = ? THEN 0
                   WHEN lower(i.name) LIKE ? ESCAPE '\\' THEN 1
                   WHEN lower(i.alias) LIKE ? ESCAPE '\\' THEN 2
                   WHEN lower(i.name) LIKE ? ESCAPE '\\' THEN 3 ELSE 4 END AS rank
       FROM item i JOIN unit u ON u.id = i.unit_id
       WHERE ${tokenClauses} AND (i.is_active = 1 OR ? = 0)
       ORDER BY rank, i.name LIMIT ?`,
    )
    .all(...params)
    .map((r) => ({
      id: Number(r['id']),
      name: String(r['name']),
      alias: r['alias'] === null ? null : String(r['alias']),
      unitId: Number(r['unit_id']),
      unitName: String(r['unit_name']),
      unitDecimals: Number(r['unit_decimals']),
      hsn: r['hsn'] === null ? null : String(r['hsn']),
      salePricePaise: Number(r['sale_price_paise']),
      costPaise: Number(r['cost_paise']),
      rateBp: r['rate_bp'] === null ? null : Number(r['rate_bp']),
      stockQty: Number(r['stock_qty']),
    }));
}

export function listItems(
  db: Db,
  args: { groupId?: number; includeInactive?: boolean } = {},
): ItemRow[] {
  return db
    .prepare(
      `${ITEM_SELECT} WHERE (? IS NULL OR i.group_id = ?) AND (i.is_active = 1 OR ? = 1) ORDER BY i.name`,
    )
    .all(args.groupId ?? null, args.groupId ?? null, args.includeInactive ? 1 : 0)
    .map(item);
}
