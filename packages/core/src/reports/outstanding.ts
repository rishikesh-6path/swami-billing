import type { Db } from '../db/connection.ts';
import type { Paise } from '../money.ts';
import { formatMoneyOrEmpty, toCsv } from './csv.ts';

export interface OpenBill {
  voucherId: number | null; // null for the opening balance
  /** What kind of voucher this is (a bill, or for example a refund payment); null for the opening balance. */
  voucherType: string | null;
  date: string | null;
  number: number | null;
  /** Prefix and number as printed, e.g. "S83"; null for the opening balance. */
  displayNumber: string | null;
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
  args: { asOn: string; side: OutstandingSide; accountId?: number | undefined },
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
       FROM account a WHERE a.group_id IN (SELECT id FROM tree)
         AND (? IS NULL OR a.id = ?) ORDER BY a.name`,
    )
    .all(groupName, args.accountId ?? null, args.accountId ?? null);

  const movements = db.prepare(
    `SELECT v.id, v.date, v.number, v.voucher_type, v.ref_voucher_id, s.prefix,
            SUM(j.dr_paise) - SUM(j.cr_paise) AS net
     FROM journal_line j JOIN voucher v ON v.id = j.voucher_id
     JOIN voucher_series s ON s.id = v.series_id
     WHERE j.account_id = ? AND v.status = 'posted' AND v.date <= ?
     GROUP BY v.id ORDER BY v.date, v.id`,
  );

  const booksStart = db.prepare('SELECT MIN(start_date) AS d FROM financial_year').get();
  const openingDate = booksStart?.['d'] == null ? null : String(booksStart['d']);

  const result: PartyOutstanding[] = [];
  for (const a of accounts) {
    const creditDays = Number(a['credit_days']);
    const open: {
      voucherId: number | null;
      voucherType: string | null;
      date: string | null;
      number: number | null;
      displayNumber: string | null;
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
    if (opening > 0)
      open.push({
        voucherId: null,
        voucherType: null,
        date: openingDate,
        number: null,
        displayNumber: null,
        amount: opening,
      });
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
            voucherType: String(m['voucher_type']),
            date: String(m['date']),
            number: Number(m['number']),
            displayNumber: `${String(m['prefix'])}${Number(m['number'])}`,
            amount: net - offset,
          });
        }
      } else {
        // a return or note first reduces the bill it was made against, if that bill is still open;
        // anything left over (and every payment) is matched against the oldest bills
        let rest = -net;
        const target =
          m['ref_voucher_id'] === null
            ? undefined
            : open.find((b) => b.voucherId === Number(m['ref_voucher_id']));
        if (target && rest > 0) {
          const used = Math.min(target.amount, rest);
          target.amount -= used;
          rest -= used;
          if (target.amount === 0) open.splice(open.indexOf(target), 1);
        }
        apply(-rest);
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
        voucherType: b.voucherType,
        date: b.date,
        number: b.number,
        displayNumber: b.displayNumber,
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

export interface CollectionRow {
  accountId: number;
  name: string;
  phone: string | null;
  /** Unpaid bills older than the customer's credit days (or `minDays` when none are given). */
  latePaise: Paise;
  /** Everything still unpaid, late or not. */
  duePaise: Paise;
  oldestLate: { label: string; date: string | null; ageDays: number } | null;
  lastPayment: { date: string; amountPaise: Paise } | null;
}

/**
 * Who to call today: customers with money that is late, the largest first, with their phone, the
 * oldest late bill and when they last paid. A customer with no credit days counts as late once a
 * bill is older than `minDays` (30 unless given).
 */
export function collectionList(
  db: Db,
  args: { asOn: string; minDays?: number | undefined },
): CollectionRow[] {
  const minDays = args.minDays ?? 30;
  const lastPaid = db.prepare(
    `SELECT v.date, SUM(j.cr_paise) AS amount FROM journal_line j JOIN voucher v ON v.id = j.voucher_id
     WHERE j.account_id = ? AND j.cr_paise > 0 AND j.is_reversal = 0 AND v.status = 'posted'
       AND v.voucher_type IN ('receipt', 'sales') AND v.date <= ?
     GROUP BY v.id ORDER BY v.date DESC, v.id DESC LIMIT 1`,
  );
  const rows: CollectionRow[] = [];
  for (const p of outstanding(db, { asOn: args.asOn, side: 'receivable' })) {
    const allowed = p.creditDays > 0 ? p.creditDays : minDays;
    const late = p.bills.filter((b) => b.ageDays > allowed);
    const latePaise = late.reduce((t, b) => t + b.amountPaise, 0);
    if (latePaise <= 0) continue;
    const oldest = late.reduce((a, b) => (b.ageDays > a.ageDays ? b : a), late[0]!);
    const paid = lastPaid.get(p.accountId, args.asOn);
    rows.push({
      accountId: p.accountId,
      name: p.accountName,
      phone: p.phone,
      latePaise,
      duePaise: p.outstandingPaise,
      oldestLate: {
        label: oldest.displayNumber ?? 'Balance from before',
        date: oldest.date,
        ageDays: oldest.ageDays,
      },
      lastPayment: paid
        ? { date: String(paid['date']), amountPaise: Number(paid['amount']) }
        : null,
    });
  }
  return rows.sort((a, b) => b.latePaise - a.latePaise || a.name.localeCompare(b.name));
}

export function collectionToCsv(rows: CollectionRow[]): string {
  return toCsv(
    [
      'Customer',
      'Phone',
      'Late',
      'Total due',
      'Oldest late bill',
      'Bill date',
      'Days',
      'Last paid on',
      'Last paid',
    ],
    [
      ...rows.map((r) => [
        r.name,
        r.phone,
        formatMoneyOrEmpty(r.latePaise),
        formatMoneyOrEmpty(r.duePaise),
        r.oldestLate?.label ?? '',
        r.oldestLate?.date ?? '',
        r.oldestLate ? String(r.oldestLate.ageDays) : '',
        r.lastPayment?.date ?? '',
        r.lastPayment ? formatMoneyOrEmpty(r.lastPayment.amountPaise) : '',
      ]),
      [
        'Total',
        '',
        formatMoneyOrEmpty(rows.reduce((t, r) => t + r.latePaise, 0)),
        formatMoneyOrEmpty(rows.reduce((t, r) => t + r.duePaise, 0)),
        '',
        '',
        '',
        '',
        '',
      ],
    ],
  );
}
