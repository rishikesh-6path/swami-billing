import type { Db } from '../db/connection.ts';
import type { Paise } from '../money.ts';
import { formatMoneyOrEmpty, toCsv } from './csv.ts';

export interface OpenBill {
  voucherId: number | null; // null for the opening balance
  date: string | null;
  number: number | null;
  amountPaise: Paise;
  ageDays: number;
  isOverdue: boolean;
}

export interface PartyOutstanding {
  accountId: number;
  accountName: string;
  phone: string | null;
  creditDays: number;
  /** Amount still to be collected (debtors) or paid (creditors). */
  outstandingPaise: Paise;
  /** Payments received/made beyond the bills they were matched against. */
  advancePaise: Paise;
  buckets: { upTo30: Paise; upTo60: Paise; upTo90: Paise; over90: Paise };
  bills: OpenBill[];
}

export type OutstandingSide = 'receivable' | 'payable';

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * Party-wise outstanding with ageing. There is no bill-by-bill allocation in the books, so
 * receipts and returns are matched first-in-first-out against the oldest bills (the account's
 * opening balance counts as the oldest). Totals always equal the ledger balance.
 */
export function outstanding(
  db: Db,
  args: { asOn: string; side: OutstandingSide },
): PartyOutstanding[] {
  const groupName = args.side === 'receivable' ? 'Sundry Debtors' : 'Sundry Creditors';
  const sign = args.side === 'receivable' ? 1 : -1;

  const accounts = db
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM account_group WHERE name = ?
         UNION ALL SELECT g.id FROM account_group g JOIN tree t ON g.parent_id = t.id)
       SELECT a.id, a.name, a.phone, a.credit_days,
              a.opening_balance_paise * CASE a.opening_is_dr WHEN 1 THEN 1 ELSE -1 END AS opening
       FROM account a WHERE a.group_id IN (SELECT id FROM tree) ORDER BY a.name`,
    )
    .all(groupName);

  const movements = db.prepare(
    `SELECT v.id, v.date, v.number, SUM(j.dr_paise) - SUM(j.cr_paise) AS net
     FROM journal_line j JOIN voucher v ON v.id = j.voucher_id
     WHERE j.account_id = ? AND v.status = 'posted' AND v.date <= ?
     GROUP BY v.id ORDER BY v.date, v.id`,
  );

  const result: PartyOutstanding[] = [];
  for (const a of accounts) {
    const creditDays = Number(a['credit_days']);
    const open: {
      voucherId: number | null;
      date: string | null;
      number: number | null;
      amount: number;
    }[] = [];
    let advance = 0;
    const apply = (amount: number) => {
      // amount > 0 is a bill; amount < 0 is a payment matched against the oldest bills
      if (amount >= 0) return;
      let remaining = -amount;
      while (remaining > 0 && open.length > 0) {
        const first = open[0]!;
        const used = Math.min(first.amount, remaining);
        first.amount -= used;
        remaining -= used;
        if (first.amount === 0) open.shift();
      }
      advance += remaining;
    };

    const opening = sign * Number(a['opening']);
    if (opening > 0) open.push({ voucherId: null, date: null, number: null, amount: opening });
    else apply(opening);

    for (const m of movements.all(Number(a['id']), args.asOn)) {
      const net = sign * Number(m['net']);
      if (net > 0) {
        // an earlier advance offsets this bill before it is listed as open
        const offset = Math.min(advance, net);
        advance -= offset;
        if (net - offset > 0) {
          open.push({
            voucherId: Number(m['id']),
            date: String(m['date']),
            number: Number(m['number']),
            amount: net - offset,
          });
        }
      } else {
        apply(net);
      }
    }

    const buckets = { upTo30: 0, upTo60: 0, upTo90: 0, over90: 0 };
    const bills = open.map((b): OpenBill => {
      const ageDays = b.date === null ? 0 : daysBetween(b.date, args.asOn);
      if (ageDays <= 30) buckets.upTo30 += b.amount;
      else if (ageDays <= 60) buckets.upTo60 += b.amount;
      else if (ageDays <= 90) buckets.upTo90 += b.amount;
      else buckets.over90 += b.amount;
      return {
        voucherId: b.voucherId,
        date: b.date,
        number: b.number,
        amountPaise: b.amount,
        ageDays,
        isOverdue: ageDays > creditDays,
      };
    });
    const outstandingPaise = bills.reduce((t, b) => t + b.amountPaise, 0);
    if (outstandingPaise === 0 && advance === 0) continue;
    result.push({
      accountId: Number(a['id']),
      accountName: String(a['name']),
      phone: a['phone'] === null ? null : String(a['phone']),
      creditDays,
      outstandingPaise,
      advancePaise: advance,
      buckets,
      bills,
    });
  }
  return result;
}

export function outstandingToCsv(rows: PartyOutstanding[]): string {
  return toCsv(
    [
      'Party',
      'Phone',
      'Outstanding',
      '0-30 days',
      '31-60 days',
      '61-90 days',
      'Over 90 days',
      'Advance',
    ],
    rows.map((r) => [
      r.accountName,
      r.phone,
      formatMoneyOrEmpty(r.outstandingPaise),
      formatMoneyOrEmpty(r.buckets.upTo30),
      formatMoneyOrEmpty(r.buckets.upTo60),
      formatMoneyOrEmpty(r.buckets.upTo90),
      formatMoneyOrEmpty(r.buckets.over90),
      formatMoneyOrEmpty(r.advancePaise),
    ]),
  );
}
