import type { Db } from '../db/connection.ts';
import type { Paise } from '../money.ts';
import { formatMoneyOrEmpty, toCsv } from './csv.ts';
import { BOOKS_START } from './financials.ts';
import { financialYearStart, nominalAccountIds } from './periods.ts';
import { stockStatus } from './stock.ts';

export interface TrialBalanceRow {
  accountId: number;
  accountName: string;
  groupName: string;
  /** Signed: positive = Dr, negative = Cr. */
  openingPaise: Paise;
  drPaise: Paise;
  crPaise: Paise;
  closingPaise: Paise;
}

export interface TrialBalance {
  from: string;
  to: string;
  rows: TrialBalanceRow[];
  totalDrPaise: Paise;
  totalCrPaise: Paise;
  /**
   * Entered opening balances plus the value of opening stock; non-zero means they do not balance
   * (stock is not an account, so it is counted here).
   */
  openingDifferencePaise: Paise;
  closingDrPaise: Paise;
  closingCrPaise: Paise;
}

/**
 * Trial balance recomputed from journal_line. Period debits always equal period credits (every
 * posted voucher balances); the opening difference is reported separately so a mistake in
 * entered opening balances is visible rather than hidden.
 */
export function trialBalance(db: Db, args: { from: string; to: string }): TrialBalance {
  const accounts = db
    .prepare(
      `SELECT a.id, a.name, g.name AS group_name,
              a.opening_balance_paise * CASE a.opening_is_dr WHEN 1 THEN 1 ELSE -1 END AS opening
       FROM account a JOIN account_group g ON g.id = a.group_id ORDER BY g.name, a.name`,
    )
    .all();

  const sums = (sql: string, ...params: string[]) => {
    const map = new Map<number, { dr: number; cr: number }>();
    for (const r of db.prepare(sql).all(...params)) {
      map.set(Number(r['account_id']), { dr: Number(r['dr']), cr: Number(r['cr']) });
    }
    return map;
  };
  const nominal = nominalAccountIds(db);
  const yearStart = financialYearStart(db, args.from);
  // real accounts carry every earlier movement forward; income and expense accounts only this year's
  const before = sums(
    `SELECT j.account_id, SUM(j.dr_paise) AS dr, SUM(j.cr_paise) AS cr
     FROM journal_line j JOIN voucher v ON v.id = j.voucher_id
     WHERE v.status = 'posted' AND v.date < ? GROUP BY j.account_id`,
    args.from,
  );
  const sinceYearStart = sums(
    `SELECT j.account_id, SUM(j.dr_paise) AS dr, SUM(j.cr_paise) AS cr
     FROM journal_line j JOIN voucher v ON v.id = j.voucher_id
     WHERE v.status = 'posted' AND v.date >= ? AND v.date < ? GROUP BY j.account_id`,
    yearStart,
    args.from,
  );
  const during = sums(
    `SELECT j.account_id, SUM(j.dr_paise) AS dr, SUM(j.cr_paise) AS cr
     FROM journal_line j JOIN voucher v ON v.id = j.voucher_id
     WHERE v.status = 'posted' AND v.date BETWEEN ? AND ? GROUP BY j.account_id`,
    args.from,
    args.to,
  );

  const rows: TrialBalanceRow[] = [];
  let openingDifference = 0;
  for (const a of accounts) {
    const id = Number(a['id']);
    const isNominal = nominal.has(id);
    const prior = (isNominal ? sinceYearStart : before).get(id) ?? { dr: 0, cr: 0 };
    const now = during.get(id) ?? { dr: 0, cr: 0 };
    const openingPaise = (isNominal ? 0 : Number(a['opening'])) + prior.dr - prior.cr;
    openingDifference += Number(a['opening']);
    if (openingPaise === 0 && now.dr === 0 && now.cr === 0) continue;
    rows.push({
      accountId: id,
      accountName: String(a['name']),
      groupName: String(a['group_name']),
      openingPaise,
      drPaise: now.dr,
      crPaise: now.cr,
      closingPaise: openingPaise + now.dr - now.cr,
    });
  }
  // Profit or loss of earlier years sits in the capital side; show it so the trial balance still balances.
  const broughtForward = [...nominal].reduce((total, id) => {
    const master = accounts.find((a) => Number(a['id']) === id);
    const earlier = db
      .prepare(
        `SELECT COALESCE(SUM(j.dr_paise), 0) - COALESCE(SUM(j.cr_paise), 0) AS net
         FROM journal_line j JOIN voucher v ON v.id = j.voucher_id
         WHERE j.account_id = ? AND v.status = 'posted' AND v.date < ?`,
      )
      .get(id, yearStart);
    return total + Number(master?.['opening'] ?? 0) + Number(earlier?.['net']);
  }, 0);
  if (broughtForward !== 0) {
    rows.push({
      accountId: 0,
      accountName: 'Profit and loss brought forward',
      groupName: 'Capital Account',
      openingPaise: broughtForward,
      drPaise: 0,
      crPaise: 0,
      closingPaise: broughtForward,
    });
  }
  // Stock is not a ledger account, so it is shown here, valued at the start of the financial year.
  // The stock change of earlier years is part of the profit brought forward, so every year balances.
  const dayBefore = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };
  const stockAtYearStart = stockStatus(db, {
    asOn: dayBefore(yearStart),
    includeInactive: true,
  }).totalValuePaise;
  const stockAtBooksStart = stockStatus(db, {
    asOn: dayBefore(BOOKS_START),
    includeInactive: true,
  }).totalValuePaise;
  openingDifference += stockAtBooksStart;
  const carriedIndex = rows.findIndex((r) => r.accountId === 0);
  if (carriedIndex >= 0) rows.splice(carriedIndex, 1);
  const carriedSigned = broughtForward - stockAtYearStart + stockAtBooksStart;
  if (carriedSigned !== 0) {
    rows.push({
      accountId: 0,
      accountName: 'Profit and loss brought forward',
      groupName: 'Capital Account',
      openingPaise: carriedSigned,
      drPaise: 0,
      crPaise: 0,
      closingPaise: carriedSigned,
    });
  }
  if (stockAtYearStart !== 0) {
    rows.push({
      accountId: -1,
      accountName: 'Stock in hand',
      groupName: 'Current Assets',
      openingPaise: stockAtYearStart,
      drPaise: 0,
      crPaise: 0,
      closingPaise: stockAtYearStart,
    });
  }
  const sum = (pick: (r: TrialBalanceRow) => number) => rows.reduce((t, r) => t + pick(r), 0);
  return {
    from: args.from,
    to: args.to,
    rows,
    totalDrPaise: sum((r) => r.drPaise),
    totalCrPaise: sum((r) => r.crPaise),
    openingDifferencePaise: openingDifference,
    closingDrPaise: sum((r) => (r.closingPaise > 0 ? r.closingPaise : 0)),
    closingCrPaise: sum((r) => (r.closingPaise < 0 ? -r.closingPaise : 0)),
  };
}

export function trialBalanceToCsv(tb: TrialBalance): string {
  const dr = (n: number) => (n > 0 ? formatMoneyOrEmpty(n) : '');
  const cr = (n: number) => (n < 0 ? formatMoneyOrEmpty(-n) : '');
  return toCsv(
    ['Group', 'Account', 'Opening Dr', 'Opening Cr', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr'],
    [
      ...tb.rows.map((r) => [
        r.groupName,
        r.accountName,
        dr(r.openingPaise),
        cr(r.openingPaise),
        formatMoneyOrEmpty(r.drPaise),
        formatMoneyOrEmpty(r.crPaise),
        dr(r.closingPaise),
        cr(r.closingPaise),
      ]),
      [
        '',
        'Total',
        '',
        '',
        formatMoneyOrEmpty(tb.totalDrPaise),
        formatMoneyOrEmpty(tb.totalCrPaise),
        formatMoneyOrEmpty(tb.closingDrPaise),
        formatMoneyOrEmpty(tb.closingCrPaise),
      ],
    ],
  );
}
