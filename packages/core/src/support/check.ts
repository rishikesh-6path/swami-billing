import type { Db } from '../db/connection.ts';
import { VOUCHER_TYPE_LABELS } from '../masters/setup.ts';

export interface BookCheck {
  /** What was checked, in plain words. */
  title: string;
  ok: boolean;
  /** What was found, in plain words. */
  message: string;
  /** Up to 20 bills that show the problem, for example "Sales S12". */
  examples: string[];
}

export interface BookHealth {
  ok: boolean;
  checks: BookCheck[];
}

const ITEM_TYPES =
  "('sales','purchase','sales_return','purchase_return','credit_note','debit_note')";
const LIMIT = 20;

/** Bills found by a query that selects v.id, as "Sales S12" for the person reading the result. */
function examples(db: Db, sql: string): { count: number; shown: string[] } {
  const ids = db
    .prepare(sql)
    .all()
    .map((r) => Number(r['id']));
  const label = db.prepare(
    'SELECT v.voucher_type, s.prefix, v.number FROM voucher v JOIN voucher_series s ON s.id = v.series_id WHERE v.id = ?',
  );
  const shown = ids.slice(0, LIMIT).map((id) => {
    const r = label.get(id);
    if (!r) return `Entry ${id}`;
    const type =
      (VOUCHER_TYPE_LABELS as Record<string, string>)[String(r['voucher_type'])] ??
      String(r['voucher_type']);
    return `${type} ${String(r['prefix'] ?? '')}${Number(r['number'])}`;
  });
  return { count: ids.length, shown };
}

function check(
  db: Db,
  title: string,
  sql: string,
  good: string,
  bad: (n: number) => string,
): BookCheck {
  const found = examples(db, sql);
  return found.count === 0
    ? { title, ok: true, message: good, examples: [] }
    : { title, ok: false, message: bad(found.count), examples: found.shown };
}

/**
 * Reads the whole data file and checks that the books still hang together: every entry balances,
 * cancelled bills are fully undone, bill totals match their lines, stock follows the bills, bill
 * numbers have no gaps, dates sit in their year, returns point at the right bills, and the file
 * itself is sound. It only reads; nothing is changed.
 */
export function checkBooks(db: Db): BookHealth {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const checks: BookCheck[] = [];

  const quick = db.prepare('PRAGMA quick_check').all();
  const fileOk = quick.length === 1 && String(Object.values(quick[0]!)[0]) === 'ok';
  checks.push({
    title: 'The data file',
    ok: fileOk,
    message: fileOk
      ? 'The data file is sound.'
      : 'The data file is damaged. Please stop billing, take a backup and call support.',
    examples: [],
  });

  checks.push(
    check(
      db,
      'Every entry balances',
      `SELECT voucher_id AS id FROM journal_line GROUP BY voucher_id
       HAVING SUM(dr_paise) <> SUM(cr_paise)`,
      'Every bill and entry has equal debits and credits.',
      (n) => `${plural(n, 'bill does', 'bills do')} not balance.`,
    ),
  );

  checks.push(
    check(
      db,
      'Every entry is in the accounts',
      `SELECT v.id FROM voucher v
       WHERE v.status <> 'draft' AND v.voucher_type NOT IN ('physical_stock', 'stock_journal')
         AND NOT EXISTS (SELECT 1 FROM journal_line j WHERE j.voucher_id = v.id AND j.is_reversal = 0)`,
      'Every bill and entry has its lines in the accounts.',
      (n) => `${plural(n, 'bill has', 'bills have')} nothing in the accounts.`,
    ),
  );

  const links = db.prepare('PRAGMA foreign_key_check').all();
  checks.push({
    title: 'Links between records',
    ok: links.length === 0,
    message:
      links.length === 0
        ? 'Every record points at records that exist.'
        : `${plural(links.length, 'record points', 'records point')} at something that no longer exists. Please take a backup and call support.`,
    examples: [],
  });

  checks.push(
    check(
      db,
      'Cancelled bills are fully undone',
      `SELECT DISTINCT id FROM (
         SELECT j.voucher_id AS id FROM journal_line j JOIN voucher v ON v.id = j.voucher_id
         WHERE v.status = 'cancelled' GROUP BY j.voucher_id, j.account_id
         HAVING SUM(j.dr_paise) <> SUM(j.cr_paise)
         UNION
         SELECT m.voucher_id AS id FROM stock_movement m JOIN voucher v ON v.id = m.voucher_id
         WHERE v.status = 'cancelled' GROUP BY m.voucher_id, m.item_id
         HAVING SUM(m.qty_in) <> SUM(m.qty_out))`,
      'Every cancelled bill has been taken out of the accounts and stock in full.',
      (n) =>
        `${plural(n, 'cancelled bill still counts', 'cancelled bills still count')} in the accounts or stock.`,
    ),
  );

  checks.push(
    check(
      db,
      'Bill totals match their lines',
      `SELECT v.id FROM voucher v
       WHERE v.voucher_type IN ${ITEM_TYPES} AND v.status <> 'draft' AND (
         v.taxable_paise <> (SELECT COALESCE(SUM(taxable_paise), 0) FROM voucher_item WHERE voucher_id = v.id)
         OR v.tax_paise <> (SELECT COALESCE(SUM(cgst_paise + sgst_paise + igst_paise), 0) FROM voucher_item WHERE voucher_id = v.id)
         OR v.total_paise <> v.taxable_paise + v.tax_paise + v.round_off_paise
              + (SELECT COALESCE(SUM(vs.amount_paise * bs.sign), 0) FROM voucher_sundry vs
                 JOIN bill_sundry bs ON bs.id = vs.bill_sundry_id
                 WHERE vs.voucher_id = v.id AND bs.affects_taxable = 0))`,
      'Every bill total equals its items, GST, charges and rounding.',
      (n) => `${plural(n, 'bill total does', 'bill totals do')} not match the lines on the bill.`,
    ),
  );

  checks.push(
    check(
      db,
      'Stock follows the bills',
      // one pass over each table (a lookup per bill took seconds on a big shop)
      `WITH lines AS (SELECT voucher_id, SUM(qty) AS q FROM voucher_item GROUP BY voucher_id),
            moved AS (SELECT voucher_id, SUM(qty_in + qty_out) AS q FROM stock_movement
                      WHERE is_reversal = 0 GROUP BY voucher_id)
       SELECT v.id FROM voucher v
       LEFT JOIN lines l ON l.voucher_id = v.id
       LEFT JOIN moved m ON m.voucher_id = v.id
       WHERE v.status = 'posted' AND v.voucher_type IN ('sales','purchase','sales_return','purchase_return')
         AND COALESCE(l.q, 0) <> COALESCE(m.q, 0)`,
      'The stock moved by every bill matches its quantities.',
      (n) =>
        `${plural(n, 'bill has', 'bills have')} stock that does not match the quantities on the bill.`,
    ),
  );

  checks.push(
    check(
      db,
      'Bill numbers have no gaps',
      `SELECT v.id FROM voucher_counter c
       JOIN voucher v ON v.voucher_type = c.voucher_type AND v.series_id = c.series_id AND v.fy_id = c.fy_id
       WHERE c.last_no <> (SELECT COUNT(*) FROM voucher x
                            WHERE x.voucher_type = c.voucher_type AND x.series_id = c.series_id AND x.fy_id = c.fy_id)
          OR c.last_no <> (SELECT MAX(number) FROM voucher x
                            WHERE x.voucher_type = c.voucher_type AND x.series_id = c.series_id AND x.fy_id = c.fy_id)
       GROUP BY c.voucher_type, c.series_id, c.fy_id`,
      'Bill numbers run without gaps in every series and year.',
      (n) =>
        `${plural(n, 'number series has', 'number series have')} a gap or a repeat (the bill shown is one from each).`,
    ),
  );

  checks.push(
    check(
      db,
      'Dates are in their year',
      `SELECT v.id FROM voucher v JOIN financial_year f ON f.id = v.fy_id
       WHERE v.date < f.start_date OR v.date > f.end_date`,
      'Every bill is dated inside its financial year.',
      (n) => `${plural(n, 'bill is', 'bills are')} filed under the wrong financial year.`,
    ),
  );

  checks.push(
    check(
      db,
      'Returns point at the right bills',
      `SELECT v.id FROM voucher v JOIN voucher r ON r.id = v.ref_voucher_id
       WHERE (v.voucher_type IN ('sales_return', 'credit_note') AND r.voucher_type <> 'sales')
          OR (v.voucher_type IN ('purchase_return', 'debit_note') AND r.voucher_type <> 'purchase')`,
      'Every return and note refers to a bill of the right kind.',
      (n) =>
        `${plural(n, 'return or note refers', 'returns or notes refer')} to the wrong kind of bill.`,
    ),
  );

  return { ok: checks.every((c) => c.ok), checks };
}
