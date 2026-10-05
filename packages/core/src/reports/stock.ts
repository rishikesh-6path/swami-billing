import type { Db } from '../db/connection.ts';
import { formatQty, lineAmount, mulDivRound, type Milli, type Paise } from '../money.ts';
import { formatMoneyOrEmpty, toCsv } from './csv.ts';

export interface StockRow {
  itemId: number;
  name: string;
  alias: string | null;
  groupName: string;
  unitName: string;
  qty: Milli;
  minStockQty: Milli;
  /** Stock value at weighted-average purchase cost; negative stock is valued at zero. */
  valuePaise: Paise;
  isNegative: boolean;
  isBelowMinimum: boolean;
}

export interface StockStatus {
  asOn: string;
  rows: StockRow[];
  totalValuePaise: Paise;
}

/**
 * Quantity of one item on hand: opening quantity plus posted movements (up to `asOn` when given).
 * Cancelled bills do not count. The one place this sum is written for a single item.
 */
export function stockOnHand(db: Db, itemId: number, asOn?: string): Milli {
  const r = db
    .prepare(
      `SELECT i.opening_qty + COALESCE((SELECT SUM(m.qty_in) - SUM(m.qty_out) FROM stock_movement m
         JOIN voucher v ON v.id = m.voucher_id
         WHERE m.item_id = i.id AND v.status = 'posted' AND (? IS NULL OR m.date <= ?)), 0) AS qty
       FROM item i WHERE i.id = ?`,
    )
    .get(asOn ?? null, asOn ?? null, itemId);
  return Number(r?.['qty'] ?? 0);
}

export interface CostBasis {
  /** Quantity and value the average is taken over: opening stock plus everything bought. */
  qty: Milli;
  cost: Paise;
  openingRatePaise: Paise;
}

/**
 * Weighted-average cost basis of every item as of a date: opening stock, purchases and
 * stock-journal receipts, less purchase returns at the price returned. Stock value and the cost
 * of goods sold both use it, so they agree.
 */
export function averageCosts(db: Db, asOn: string): Map<number, CostBasis> {
  const out = new Map<number, CostBasis>();
  for (const i of db.prepare('SELECT id, opening_qty, opening_rate_paise FROM item').all()) {
    const openingQty = Math.max(Number(i['opening_qty']), 0);
    out.set(Number(i['id']), {
      qty: openingQty,
      cost: lineAmount(openingQty, Number(i['opening_rate_paise'])),
      openingRatePaise: Number(i['opening_rate_paise']),
    });
  }
  for (const r of db
    .prepare(
      `SELECT m.item_id, v.voucher_type, m.qty_in, m.qty_out, m.rate_paise
       FROM stock_movement m JOIN voucher v ON v.id = m.voucher_id
       WHERE v.status = 'posted' AND m.is_reversal = 0 AND m.date <= ?
         AND (v.voucher_type IN ('purchase', 'purchase_return')
              OR (v.voucher_type = 'stock_journal' AND m.qty_in > 0))`,
    )
    .all(asOn)) {
    const entry = out.get(Number(r['item_id']));
    if (!entry) continue;
    const sign = r['voucher_type'] === 'purchase_return' ? -1 : 1;
    const qty = Number(r['qty_in']) + Number(r['qty_out']);
    entry.qty += sign * qty;
    entry.cost += sign * lineAmount(qty, Number(r['rate_paise']));
  }
  return out;
}

/** What `qty` of an item is worth at its average cost (opening rate when nothing was ever bought). */
export function costOf(costs: Map<number, CostBasis>, itemId: number, qty: Milli): Paise {
  const basis = costs.get(itemId);
  if (!basis) return 0;
  const basisQty = Math.max(basis.qty, 0);
  const basisCost = Math.max(basis.cost, 0);
  return basisQty > 0
    ? mulDivRound(qty, basisCost, basisQty)
    : lineAmount(qty, basis.openingRatePaise);
}

/**
 * Stock on hand as of a date: opening quantity plus posted movements up to that date,
 * recomputed from stock_movement only (KICKOFF invariant 2). Cancelled vouchers are ignored
 * because their reversal lines net them to zero.
 */
export function stockStatus(
  db: Db,
  args: { asOn: string; groupId?: number; onlyProblems?: boolean; includeInactive?: boolean },
): StockStatus {
  const items = db
    .prepare(
      `SELECT i.id, i.name, i.alias, i.opening_qty, i.opening_rate_paise, i.min_stock_qty,
              g.name AS group_name, u.name AS unit_name
       FROM item i JOIN item_group g ON g.id = i.group_id JOIN unit u ON u.id = i.unit_id
       WHERE (i.is_active = 1 OR ? = 1) AND (? IS NULL OR i.group_id = ?)
       ORDER BY g.name, i.name`,
    )
    .all(args.includeInactive ? 1 : 0, args.groupId ?? null, args.groupId ?? null);

  const moved = new Map<number, number>();
  for (const r of db
    .prepare(
      `SELECT m.item_id, SUM(m.qty_in) - SUM(m.qty_out) AS net
       FROM stock_movement m JOIN voucher v ON v.id = m.voucher_id
       WHERE v.status = 'posted' AND m.date <= ? GROUP BY m.item_id`,
    )
    .all(args.asOn)) {
    moved.set(Number(r['item_id']), Number(r['net']));
  }

  const costs = averageCosts(db, args.asOn);

  const rows = items.map((i): StockRow => {
    const id = Number(i['id']);
    const qty = Number(i['opening_qty']) + (moved.get(id) ?? 0);
    const onHand = Math.max(qty, 0);
    const valuePaise = costOf(costs, id, onHand);
    const min = Number(i['min_stock_qty']);
    return {
      itemId: id,
      name: String(i['name']),
      alias: i['alias'] === null ? null : String(i['alias']),
      groupName: String(i['group_name']),
      unitName: String(i['unit_name']),
      qty,
      minStockQty: min,
      valuePaise,
      isNegative: qty < 0,
      isBelowMinimum: min > 0 && qty < min,
    };
  });

  const shown = args.onlyProblems ? rows.filter((r) => r.isNegative || r.isBelowMinimum) : rows;
  return {
    asOn: args.asOn,
    rows: shown,
    totalValuePaise: shown.reduce((sum, r) => sum + r.valuePaise, 0),
  };
}

export function stockStatusToCsv(status: StockStatus): string {
  return toCsv(
    ['Group', 'Item', 'Alias', 'Unit', 'Quantity', 'Value', 'Note'],
    status.rows.map((r) => [
      r.groupName,
      r.name,
      r.alias,
      r.unitName,
      formatQty(r.qty),
      formatMoneyOrEmpty(r.valuePaise),
      r.isNegative ? 'Negative stock' : r.isBelowMinimum ? 'Below minimum' : '',
    ]),
  );
}

/** The counting sheet: what the books say, and an empty column for what is counted on the shelf. */
export function stockSheetToCsv(status: StockStatus): string {
  return toCsv(
    ['Group', 'Item', 'Alias', 'Unit', 'In the books', 'Counted'],
    status.rows.map((r) => [r.groupName, r.name, r.alias, r.unitName, formatQty(r.qty), '']),
  );
}

export interface ItemLedgerRow {
  voucherId: number;
  date: string;
  voucherType: string;
  number: number;
  partyName: string | null;
  qtyIn: Milli;
  qtyOut: Milli;
  ratePaise: Paise;
  balanceQty: Milli;
}

export interface ItemLedger {
  itemId: number;
  itemName: string;
  from: string;
  to: string;
  openingQty: Milli;
  rows: ItemLedgerRow[];
  closingQty: Milli;
}

/** Every posted stock movement of one item in a period, with a running quantity. */
export function itemLedger(db: Db, args: { itemId: number; from: string; to: string }): ItemLedger {
  const item = db.prepare('SELECT name, opening_qty FROM item WHERE id = ?').get(args.itemId);
  if (!item) throw new Error(`Item ${args.itemId} does not exist`);

  const before = db
    .prepare(
      `SELECT COALESCE(SUM(m.qty_in), 0) - COALESCE(SUM(m.qty_out), 0) AS net
       FROM stock_movement m JOIN voucher v ON v.id = m.voucher_id
       WHERE m.item_id = ? AND v.status = 'posted' AND m.date < ?`,
    )
    .get(args.itemId, args.from);
  const openingQty = Number(item['opening_qty']) + Number(before?.['net']);

  // reversal rows are not shown: a cancelled voucher is excluded entirely
  const moves = db
    .prepare(
      `SELECT m.voucher_id, m.date, v.voucher_type, v.number, a.name AS party,
              m.qty_in, m.qty_out, m.rate_paise
       FROM stock_movement m JOIN voucher v ON v.id = m.voucher_id
       LEFT JOIN account a ON a.id = v.party_account_id
       WHERE m.item_id = ? AND v.status = 'posted' AND m.date BETWEEN ? AND ?
       ORDER BY m.date, m.id`,
    )
    .all(args.itemId, args.from, args.to);

  let balance = openingQty;
  const rows = moves.map((m): ItemLedgerRow => {
    balance += Number(m['qty_in']) - Number(m['qty_out']);
    return {
      voucherId: Number(m['voucher_id']),
      date: String(m['date']),
      voucherType: String(m['voucher_type']),
      number: Number(m['number']),
      partyName: m['party'] === null ? null : String(m['party']),
      qtyIn: Number(m['qty_in']),
      qtyOut: Number(m['qty_out']),
      ratePaise: Number(m['rate_paise']),
      balanceQty: balance,
    };
  });
  return {
    itemId: args.itemId,
    itemName: String(item['name']),
    from: args.from,
    to: args.to,
    openingQty,
    rows,
    closingQty: balance,
  };
}

export function itemLedgerToCsv(ledger: ItemLedger): string {
  return toCsv(
    ['Date', 'Type', 'Number', 'Party', 'In', 'Out', 'Rate', 'Balance'],
    [
      ['', '', '', 'Opening', '', '', '', formatQty(ledger.openingQty)],
      ...ledger.rows.map((r) => [
        r.date,
        r.voucherType,
        r.number,
        r.partyName,
        r.qtyIn === 0 ? '' : formatQty(r.qtyIn),
        r.qtyOut === 0 ? '' : formatQty(r.qtyOut),
        formatMoneyOrEmpty(r.ratePaise),
        formatQty(r.balanceQty),
      ]),
      ['', '', '', 'Closing', '', '', '', formatQty(ledger.closingQty)],
    ],
  );
}
