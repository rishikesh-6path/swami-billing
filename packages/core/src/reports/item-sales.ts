import type { Db } from '../db/connection.ts';
import { formatMoney, formatQty, mulDivRound, type Milli, type Paise } from '../money.ts';
import { toCsv } from './csv.ts';
import { averageCosts, costKnown, costOf } from './stock.ts';

export interface ItemSalesRow {
  itemId: number;
  name: string;
  alias: string | null;
  groupName: string;
  unitName: string;
  /** Sold less returned. */
  qty: Milli;
  /** Sales before GST, less returns and credit notes. */
  valuePaise: Paise;
  /** What those goods cost, at the average purchase cost (as stock is valued). */
  costPaise: Paise;
  profitPaise: Paise;
  /** Profit as a share of the sales value, in basis points; null when nothing was sold or the cost is not known. */
  marginBp: number | null;
  /** False when the item was never bought and has no opening rate: its cost shows as 0. */
  costKnown: boolean;
}

export interface ItemSales {
  from: string;
  to: string;
  rows: ItemSalesRow[];
  totals: { valuePaise: Paise; costPaise: Paise; profitPaise: Paise; marginBp: number | null };
}

const margin = (profit: number, value: number) =>
  value > 0 ? mulDivRound(profit, 10000, value) : null;

/**
 * What sold in a period, item by item, with what it earned. Sales add, sales returns take back
 * quantity and value, credit notes take back value only. Cancelled bills are left out. The cost
 * is the item's weighted-average purchase cost at the end of the period, the same figure the
 * stock report and the profit and loss account use.
 */
export function itemSales(
  db: Db,
  args: { from: string; to: string; groupId?: number | undefined },
): ItemSales {
  const rows = db
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM item_group WHERE id = ?
         UNION SELECT g.id FROM item_group g JOIN tree t ON g.parent_id = t.id)
       SELECT i.id, i.name, i.alias, g.name AS group_name, u.name AS unit_name,
              SUM(CASE v.voucher_type WHEN 'sales' THEN vi.qty WHEN 'sales_return' THEN -vi.qty ELSE 0 END) AS qty,
              SUM(CASE v.voucher_type WHEN 'sales' THEN vi.taxable_paise ELSE -vi.taxable_paise END) AS value
       FROM voucher_item vi
       JOIN voucher v ON v.id = vi.voucher_id
       JOIN item i ON i.id = vi.item_id
       JOIN item_group g ON g.id = i.group_id
       JOIN unit u ON u.id = i.unit_id
       WHERE v.status = 'posted' AND v.date BETWEEN ? AND ?
         AND v.voucher_type IN ('sales', 'sales_return', 'credit_note')
         AND (? IS NULL OR i.group_id IN (SELECT id FROM tree))
       GROUP BY i.id
       ORDER BY g.name, i.name`,
    )
    .all(args.groupId ?? 0, args.from, args.to, args.groupId ?? null);
  const costs = averageCosts(db, args.to);
  const out = rows.map((r): ItemSalesRow => {
    const qty = Number(r['qty']);
    const value = Number(r['value']);
    const cost = costOf(costs, Number(r['id']), qty);
    const known = costKnown(costs, Number(r['id']));
    return {
      itemId: Number(r['id']),
      name: String(r['name']),
      alias: r['alias'] === null ? null : String(r['alias']),
      groupName: String(r['group_name']),
      unitName: String(r['unit_name']),
      qty,
      valuePaise: value,
      costPaise: cost,
      profitPaise: value - cost,
      marginBp: known ? margin(value - cost, value) : null,
      costKnown: known,
    };
  });
  const valuePaise = out.reduce((t, r) => t + r.valuePaise, 0);
  const costPaise = out.reduce((t, r) => t + r.costPaise, 0);
  return {
    from: args.from,
    to: args.to,
    rows: out,
    totals: {
      valuePaise,
      costPaise,
      profitPaise: valuePaise - costPaise,
      marginBp: margin(valuePaise - costPaise, valuePaise),
    },
  };
}

const pct = (bp: number | null) => (bp === null ? '' : (bp / 100).toFixed(2));

export function itemSalesToCsv(report: ItemSales): string {
  return toCsv(
    [
      'Group',
      'Item',
      'Alias',
      'Unit',
      'Quantity',
      'Sales before GST',
      'Cost',
      'Profit',
      'Margin %',
      'Note',
    ],
    [
      ...report.rows.map((r) => [
        r.groupName,
        r.name,
        r.alias,
        r.unitName,
        formatQty(r.qty),
        formatMoney(r.valuePaise),
        formatMoney(r.costPaise),
        formatMoney(r.profitPaise),
        pct(r.marginBp),
        r.costKnown ? '' : 'Cost not known (never bought, no opening rate)',
      ]),
      [
        'Total',
        '',
        '',
        '',
        '',
        formatMoney(report.totals.valuePaise),
        formatMoney(report.totals.costPaise),
        formatMoney(report.totals.profitPaise),
        pct(report.totals.marginBp),
        '',
      ],
    ],
  );
}
