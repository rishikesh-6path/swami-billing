import type { Db } from '../db/connection.ts';
import type { Paise } from '../money.ts';
import { formatMoneyOrEmpty, toCsv } from './csv.ts';

export interface DayBookRow {
  voucherId: number;
  date: string;
  voucherType: string;
  number: number;
  partyName: string | null;
  narration: string | null;
  totalPaise: Paise;
  isCancelled: boolean;
}

/** Every voucher in a period in entry order. Cancelled vouchers are listed and marked. */
export function dayBook(db: Db, args: { from: string; to: string }): DayBookRow[] {
  return db
    .prepare(
      `SELECT v.id, v.date, v.voucher_type, v.number, a.name AS party, v.narration,
              v.total_paise, v.status
       FROM voucher v LEFT JOIN account a ON a.id = v.party_account_id
       WHERE v.status <> 'draft' AND v.date BETWEEN ? AND ?
       ORDER BY v.date, v.id`,
    )
    .all(args.from, args.to)
    .map((r) => ({
      voucherId: Number(r['id']),
      date: String(r['date']),
      voucherType: String(r['voucher_type']),
      number: Number(r['number']),
      partyName: r['party'] === null ? null : String(r['party']),
      narration: r['narration'] === null ? null : String(r['narration']),
      totalPaise: Number(r['total_paise']),
      isCancelled: r['status'] === 'cancelled',
    }));
}

export function dayBookToCsv(rows: DayBookRow[]): string {
  return toCsv(
    ['Date', 'Type', 'Number', 'Party', 'Narration', 'Amount', 'Status'],
    rows.map((r) => [
      r.date,
      r.voucherType,
      r.number,
      r.partyName,
      r.narration,
      formatMoneyOrEmpty(r.totalPaise),
      r.isCancelled ? 'Cancelled' : '',
    ]),
  );
}

export interface DaySummary {
  date: string;
  byType: { voucherType: string; count: number; totalPaise: Paise }[];
  cancelledCount: number;
  cashInPaise: Paise;
  cashOutPaise: Paise;
  cashClosingPaise: Paise;
}

/** One day at a glance: vouchers by type and the movement and closing balance of Cash. */
export function daySummary(db: Db, args: { date: string }): DaySummary {
  const byType = db
    .prepare(
      `SELECT voucher_type, COUNT(*) AS n, SUM(total_paise) AS total
       FROM voucher WHERE status = 'posted' AND date = ? GROUP BY voucher_type ORDER BY voucher_type`,
    )
    .all(args.date)
    .map((r) => ({
      voucherType: String(r['voucher_type']),
      count: Number(r['n']),
      totalPaise: Number(r['total']),
    }));
  const cancelled = db
    .prepare("SELECT COUNT(*) AS n FROM voucher WHERE status = 'cancelled' AND date = ?")
    .get(args.date);

  const cash = db
    .prepare(
      "SELECT id, opening_balance_paise, opening_is_dr FROM account WHERE name = 'Cash' AND is_system = 1",
    )
    .get();
  if (!cash) throw new Error('The Cash account is missing');
  const day = db
    .prepare(
      `SELECT COALESCE(SUM(j.dr_paise), 0) AS dr, COALESCE(SUM(j.cr_paise), 0) AS cr
       FROM journal_line j JOIN voucher v ON v.id = j.voucher_id
       WHERE j.account_id = ? AND v.status = 'posted' AND v.date = ?`,
    )
    .get(cash['id'] as number, args.date);
  const upTo = db
    .prepare(
      `SELECT COALESCE(SUM(j.dr_paise), 0) - COALESCE(SUM(j.cr_paise), 0) AS net
       FROM journal_line j JOIN voucher v ON v.id = j.voucher_id
       WHERE j.account_id = ? AND v.status = 'posted' AND v.date <= ?`,
    )
    .get(cash['id'] as number, args.date);
  const opening = Number(cash['opening_balance_paise']) * (cash['opening_is_dr'] ? 1 : -1);
  return {
    date: args.date,
    byType,
    cancelledCount: Number(cancelled?.['n']),
    cashInPaise: Number(day?.['dr']),
    cashOutPaise: Number(day?.['cr']),
    cashClosingPaise: opening + Number(upTo?.['net']),
  };
}
