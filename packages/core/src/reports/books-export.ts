import type { Db } from '../db/connection.ts';
import { VOUCHER_TYPE_LABELS } from '../masters/setup.ts';
import { formatMoney, formatQty } from '../money.ts';
import { toCsv } from './csv.ts';

type Period = { from: string; to: string };
const label = (type: string) => (VOUCHER_TYPE_LABELS as Record<string, string>)[type] ?? type;
const statusText = (status: string) => (status === 'cancelled' ? 'Cancelled' : 'Posted');
const fyLabel = (start: string, end: string) => `${start.slice(0, 4)}-${end.slice(2, 4)}`;
const REDUCES = ['sales_return', 'credit_note', 'purchase_return', 'debit_note'];
/** What the row adds to a total: nothing for a cancelled bill, minus for a return or note. */
const addingUp = (type: string, status: string, total: number) =>
  status === 'cancelled' ? 0 : REDUCES.includes(type) ? -total : total;
const percent = (bp: number) => (bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2));

/**
 * Every bill and entry in the period, one row each, cancelled ones included and marked so the
 * accountant sees why a number is missing from the totals. Total is the document's own value (a
 * return or note is not negative); Total for adding up is signed (negative for returns and notes,
 * nothing for cancelled bills) and agrees with the registers.
 */
export function vouchersCsv(db: Db, args: Period): string {
  const rows = db
    .prepare(
      `SELECT v.date, v.voucher_type, s.prefix, v.number, a.name AS party,
              CASE WHEN v.pos_state_code IS NOT NULL THEN v.party_gstin ELSE a.gstin END AS gstin, v.taxable_paise, v.round_off_paise,
              v.total_paise, v.status, v.party_bill_no, v.party_bill_date, v.narration, v.tax_paise,
              f.start_date AS fy_start, f.end_date AS fy_end,
              COALESCE((SELECT SUM(cgst_paise) FROM voucher_item WHERE voucher_id = v.id), 0) AS cgst,
              COALESCE((SELECT SUM(sgst_paise) FROM voucher_item WHERE voucher_id = v.id), 0) AS sgst,
              COALESCE((SELECT SUM(igst_paise) FROM voucher_item WHERE voucher_id = v.id), 0) AS igst
       FROM voucher v
       JOIN voucher_series s ON s.id = v.series_id
       JOIN financial_year f ON f.id = v.fy_id
       LEFT JOIN account a ON a.id = v.party_account_id
       WHERE v.status <> 'draft' AND v.date BETWEEN ? AND ?
       ORDER BY v.date, v.id`,
    )
    .all(args.from, args.to);
  return toCsv(
    [
      'Date',
      'Type',
      'Number',
      'Financial year',
      'Party',
      'GST number',
      'Taxable',
      'CGST',
      'SGST',
      'IGST',
      'Other charges',
      'Round off',
      'Total',
      'Total for adding up',
      'Status',
      "Supplier's invoice no.",
      "Supplier's invoice date",
      'Narration',
    ],
    rows.map((r) => [
      String(r['date']),
      label(String(r['voucher_type'])),
      `${String(r['prefix'] ?? '')}${Number(r['number'])}`,
      fyLabel(String(r['fy_start']), String(r['fy_end'])),
      r['party'] === null ? '' : String(r['party']),
      r['gstin'] === null ? '' : String(r['gstin']),
      formatMoney(Number(r['taxable_paise'])),
      formatMoney(Number(r['cgst'])),
      formatMoney(Number(r['sgst'])),
      formatMoney(Number(r['igst'])),
      formatMoney(
        Number(r['total_paise']) -
          Number(r['taxable_paise']) -
          Number(r['tax_paise']) -
          Number(r['round_off_paise']),
      ),
      formatMoney(Number(r['round_off_paise'])),
      formatMoney(Number(r['total_paise'])),
      formatMoney(
        addingUp(String(r['voucher_type']), String(r['status']), Number(r['total_paise'])),
      ),
      statusText(String(r['status'])),
      r['party_bill_no'] === null ? '' : String(r['party_bill_no']),
      r['party_bill_date'] === null ? '' : String(r['party_bill_date']),
      r['narration'] === null ? '' : String(r['narration']),
    ]),
  );
}

/**
 * Every ledger line behind those bills: which account was debited or credited and by how much.
 * Debits and credits of the whole file are equal. A cancelled bill shows its original lines and
 * the lines that reverse them.
 */
export function journalCsv(db: Db, args: Period): string {
  const rows = db
    .prepare(
      `SELECT v.date, v.voucher_type, s.prefix, v.number, a.name AS account, j.dr_paise, j.cr_paise,
              j.is_reversal, v.status, f.start_date AS fy_start, f.end_date AS fy_end
       FROM journal_line j
       JOIN voucher v ON v.id = j.voucher_id
       JOIN financial_year f ON f.id = v.fy_id
       JOIN voucher_series s ON s.id = v.series_id
       JOIN account a ON a.id = j.account_id
       WHERE v.status <> 'draft' AND v.date BETWEEN ? AND ?
       ORDER BY v.date, v.id, j.is_reversal, j.line_no`,
    )
    .all(args.from, args.to);
  return toCsv(
    [
      'Date',
      'Type',
      'Number',
      'Financial year',
      'Account',
      'Debit',
      'Credit',
      'Reversal of a cancelled bill',
    ],
    rows.map((r) => [
      String(r['date']),
      label(String(r['voucher_type'])),
      `${String(r['prefix'] ?? '')}${Number(r['number'])}`,
      fyLabel(String(r['fy_start']), String(r['fy_end'])),
      String(r['account']),
      Number(r['dr_paise']) === 0 ? '' : formatMoney(Number(r['dr_paise'])),
      Number(r['cr_paise']) === 0 ? '' : formatMoney(Number(r['cr_paise'])),
      Number(r['is_reversal']) === 1 ? 'Yes' : '',
    ]),
  );
}

/** The item list in the same columns the spreadsheet import reads, so it can be loaded again. */
export function itemsCsv(db: Db): string {
  const rows = db
    .prepare(
      `SELECT i.name, i.alias, g.name AS group_name, u.name AS unit_name, i.hsn, i.opening_qty,
              i.opening_rate_paise, i.sale_price_paise, i.mrp_paise, i.min_stock_qty,
              (SELECT rate_bp FROM item_tax_rate WHERE item_id = i.id
               ORDER BY effective_from DESC LIMIT 1) AS rate_bp
       FROM item i
       JOIN item_group g ON g.id = i.group_id
       JOIN unit u ON u.id = i.unit_id
       WHERE i.is_active = 1
       ORDER BY g.name, i.name`,
    )
    .all();
  return toCsv(
    [
      'Name',
      'Alias',
      'Group',
      'Unit',
      'HSN',
      'GST %',
      'Price',
      'MRP',
      'Opening stock',
      'Opening rate',
      'Min stock',
    ],
    rows.map((r) => [
      String(r['name']),
      r['alias'] === null ? '' : String(r['alias']),
      String(r['group_name']),
      String(r['unit_name']),
      r['hsn'] === null ? '' : String(r['hsn']),
      r['rate_bp'] === null ? '' : percent(Number(r['rate_bp'])),
      formatMoney(Number(r['sale_price_paise'])),
      formatMoney(Number(r['mrp_paise'])),
      formatQty(Number(r['opening_qty'])),
      formatMoney(Number(r['opening_rate_paise'])),
      formatQty(Number(r['min_stock_qty'])),
    ]),
  );
}

/** Customers or suppliers in the columns the spreadsheet import reads. */
export function partiesCsv(db: Db, kind: 'customer' | 'supplier'): string {
  const rows = db
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM account_group WHERE name = ?
         UNION ALL SELECT g.id FROM account_group g JOIN tree t ON g.parent_id = t.id)
       SELECT a.name, a.phone, a.gstin, a.state_code, a.address, a.credit_days,
              a.credit_limit_paise, a.opening_balance_paise, a.opening_is_dr
       FROM account a
       WHERE a.group_id IN (SELECT id FROM tree) AND a.is_system = 0
       ORDER BY a.name`,
    )
    .all(kind === 'supplier' ? 'Sundry Creditors' : 'Sundry Debtors');
  return toCsv(
    [
      'Name',
      'Phone',
      'GSTIN',
      'State',
      'Address',
      'Credit days',
      'Opening balance',
      'Dr/Cr',
      'Credit limit',
    ],
    rows.map((r) => [
      String(r['name']),
      r['phone'] === null ? '' : String(r['phone']),
      r['gstin'] === null ? '' : String(r['gstin']),
      r['state_code'] === null ? '' : String(r['state_code']),
      r['address'] === null ? '' : String(r['address']),
      Number(r['credit_days']),
      formatMoney(Number(r['opening_balance_paise'])),
      Number(r['opening_is_dr']) === 1 ? 'Dr' : 'Cr',
      Number(r['credit_limit_paise']) === 0 ? '' : formatMoney(Number(r['credit_limit_paise'])),
    ]),
  );
}

/** The files saved together for the accountant, and a plain note saying what each one is. */
export function accountantFiles(db: Db, args: Period): Record<string, string> {
  return {
    'Bills and entries.csv': vouchersCsv(db, args),
    'Ledger lines.csv': journalCsv(db, args),
    'Items.csv': itemsCsv(db),
    'Customers.csv': partiesCsv(db, 'customer'),
    'Suppliers.csv': partiesCsv(db, 'supplier'),
    'Read me.txt': [
      `ShopLedger data for the accountant, ${args.from} to ${args.to}.`,
      '',
      'Bills and entries.csv: every bill and entry of the period, one row each. Cancelled bills are',
      'listed and marked Cancelled. Returns and notes show their own value, with the Type saying what they are.',
      'Ledger lines.csv: the debit and credit lines behind them. The Debit and Credit columns add up to the same total.',
      'Items.csv, Customers.csv, Suppliers.csv: the lists as they are today (opening balances are the ones',
      'entered when the shop started). They can be loaded into ShopLedger again with Import.',
      '',
    ].join('\n'),
  };
}
