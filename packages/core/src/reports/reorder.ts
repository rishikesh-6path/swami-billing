import type { Db } from '../db/connection.ts';
import { formatQty, type Milli, type Paise } from '../money.ts';
import { toCsv, formatMoneyOrEmpty } from './csv.ts';
import { stockStatus } from './stock.ts';

export interface ReorderRow {
  itemId: number;
  name: string;
  alias: string | null;
  groupName: string;
  unitName: string;
  qty: Milli;
  minStockQty: Milli;
  /** How much is needed to get back to the minimum (never negative). */
  shortfallQty: Milli;
  /** Who the item was last bought from, and at what price, if it ever was. */
  lastSupplier: string | null;
  lastCostPaise: Paise | null;
  lastBoughtOn: string | null;
}

/** Items below their minimum stock (or negative), with the supplier and cost of the last purchase. */
export function reorderList(db: Db, args: { asOn: string }): ReorderRow[] {
  const last = db.prepare(
    `SELECT a.name AS supplier, vi.price_paise AS cost, v.date
     FROM voucher_item vi JOIN voucher v ON v.id = vi.voucher_id
     LEFT JOIN account a ON a.id = v.party_account_id
     WHERE vi.item_id = ? AND v.voucher_type = 'purchase' AND v.status = 'posted' AND v.date <= ?
     ORDER BY v.date DESC, v.id DESC, vi.line_no DESC LIMIT 1`,
  );
  return stockStatus(db, { asOn: args.asOn, onlyProblems: true })
    .rows.filter((r) => r.isBelowMinimum || r.isNegative)
    .map((r): ReorderRow => {
      const l = last.get(r.itemId, args.asOn);
      return {
        itemId: r.itemId,
        name: r.name,
        alias: r.alias,
        groupName: r.groupName,
        unitName: r.unitName,
        qty: r.qty,
        minStockQty: r.minStockQty,
        shortfallQty: Math.max(0, r.minStockQty - r.qty),
        lastSupplier: l ? (l['supplier'] === null ? null : String(l['supplier'])) : null,
        lastCostPaise: l ? Number(l['cost']) : null,
        lastBoughtOn: l ? String(l['date']) : null,
      };
    })
    .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name));
}

export function reorderToCsv(rows: ReorderRow[]): string {
  return toCsv(
    [
      'Group',
      'Item',
      'Alias',
      'Unit',
      'In stock',
      'Minimum',
      'Needed',
      'Last supplier',
      'Last cost',
      'Last bought',
    ],
    rows.map((r) => [
      r.groupName,
      r.name,
      r.alias,
      r.unitName,
      formatQty(r.qty),
      formatQty(r.minStockQty),
      formatQty(r.shortfallQty),
      r.lastSupplier,
      r.lastCostPaise === null ? '' : formatMoneyOrEmpty(r.lastCostPaise),
      r.lastBoughtOn,
    ]),
  );
}
