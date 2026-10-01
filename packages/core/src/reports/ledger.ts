import type { Db } from '../db/connection.ts';
import type { Paise } from '../money.ts';
import { formatBalance, formatMoneyOrEmpty, toCsv } from './csv.ts';
import { financialYearStart, nominalAccountIds } from './periods.ts';

export interface LedgerRow {
  voucherId: number;
  date: string;
  voucherType: string;
  number: number;
  particulars: string;
  drPaise: Paise;
  crPaise: Paise;
  /** Running balance after this row; positive = Dr, negative = Cr. */
  balancePaise: Paise;
}

export interface AccountLedger {
  accountId: number;
  accountName: string;
  from: string;
  to: string;
  openingPaise: Paise;
  rows: LedgerRow[];
  totalDrPaise: Paise;
  totalCrPaise: Paise;
  closingPaise: Paise;
}

/**
 * Account ledger recomputed from journal_line only (KICKOFF invariant 4): closing = opening
 * + movements, no cached balances. Cancelled and draft vouchers are not shown; a cancelled
 * voucher's reversal lines net its original lines to zero, so balances are unaffected.
 * Opening = the account's master opening balance plus all posted movement dated before `from`.
 */
export function accountLedger(
  db: Db,
  args: { accountId: number; from: string; to: string },
): AccountLedger {
  const account = db
    .prepare('SELECT name, opening_balance_paise, opening_is_dr FROM account WHERE id = ?')
    .get(args.accountId);
  if (!account) throw new Error(`Account ${args.accountId} does not exist`);

  // income and expense accounts start every financial year at zero
  const isNominal = nominalAccountIds(db).has(args.accountId);
  const before = db
    .prepare(
      `SELECT COALESCE(SUM(j.dr_paise), 0) - COALESCE(SUM(j.cr_paise), 0) AS net
       FROM journal_line j JOIN voucher v ON v.id = j.voucher_id
       WHERE j.account_id = ? AND v.status = 'posted' AND v.date >= ? AND v.date < ?`,
    )
    .get(args.accountId, isNominal ? financialYearStart(db, args.from) : '0000-01-01', args.from);
  const masterOpening = isNominal
    ? 0
    : Number(account['opening_balance_paise']) * (account['opening_is_dr'] ? 1 : -1);
  const openingPaise = masterOpening + Number(before?.['net']);

  const movements = db
    .prepare(
      `SELECT v.id, v.date, v.voucher_type, v.number,
              SUM(j.dr_paise) AS dr, SUM(j.cr_paise) AS cr
       FROM journal_line j JOIN voucher v ON v.id = j.voucher_id
       WHERE j.account_id = ? AND v.status = 'posted' AND v.date BETWEEN ? AND ?
       GROUP BY v.id ORDER BY v.date, v.id`,
    )
    .all(args.accountId, args.from, args.to);

  const others = db.prepare(
    `SELECT a.name AS name FROM journal_line j JOIN account a ON a.id = j.account_id
     WHERE j.voucher_id = ? AND j.account_id <> ? GROUP BY a.id ORDER BY MIN(j.line_no)`,
  );

  let balance = openingPaise;
  let totalDr = 0;
  let totalCr = 0;
  const rows = movements.map((m): LedgerRow => {
    const dr = Number(m['dr']);
    const cr = Number(m['cr']);
    balance += dr - cr;
    totalDr += dr;
    totalCr += cr;
    const voucherId = Number(m['id']);
    return {
      voucherId,
      date: String(m['date']),
      voucherType: String(m['voucher_type']),
      number: Number(m['number']),
      particulars: others
        .all(voucherId, args.accountId)
        .map((o) => String(o['name']))
        .join(', '),
      drPaise: dr,
      crPaise: cr,
      balancePaise: balance,
    };
  });

  return {
    accountId: args.accountId,
    accountName: String(account['name']),
    from: args.from,
    to: args.to,
    openingPaise,
    rows,
    totalDrPaise: totalDr,
    totalCrPaise: totalCr,
    closingPaise: balance,
  };
}

/** Normalised CSV for golden-file comparison against Busy's exported ledger. */
export function ledgerToCsv(ledger: AccountLedger): string {
  return toCsv(
    ['Date', 'Type', 'Number', 'Particulars', 'Debit', 'Credit', 'Balance'],
    [
      ['', '', '', 'Opening Balance', '', '', formatBalance(ledger.openingPaise)],
      ...ledger.rows.map((r) => [
        r.date,
        r.voucherType,
        r.number,
        r.particulars,
        formatMoneyOrEmpty(r.drPaise),
        formatMoneyOrEmpty(r.crPaise),
        formatBalance(r.balancePaise),
      ]),
      [
        '',
        '',
        '',
        'Closing Balance',
        formatMoneyOrEmpty(ledger.totalDrPaise),
        formatMoneyOrEmpty(ledger.totalCrPaise),
        formatBalance(ledger.closingPaise),
      ],
    ],
  );
}
