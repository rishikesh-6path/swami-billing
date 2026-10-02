import type { Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import type { Paise } from '../money.ts';
import { accountBalance } from './ledger.ts';
import { outstanding } from './outstanding.ts';

export interface PartySummary {
  id: number;
  name: string;
  kind: 'customer' | 'supplier';
  gstin: string | null;
  phone: string | null;
  address: string | null;
  stateCode: string | null;
  creditDays: number;
  /** Positive = they owe us (Dr), negative = we owe them (Cr). */
  balancePaise: Paise;
  /** Still to be collected (customers) or paid (suppliers), from bills not yet settled. */
  outstandingPaise: Paise;
  /** Money received or paid beyond the bills (an advance). */
  advancePaise: Paise;
  /** The part of the outstanding that is past the credit days. */
  overduePaise: Paise;
  /** The oldest unsettled bill that is past its credit days, if any. */
  oldestOverdue: { label: string; date: string | null; ageDays: number; amountPaise: Paise } | null;
  recentBills: SummaryVoucher[];
  recentPayments: SummaryVoucher[];
}

export interface SummaryVoucher {
  id: number;
  voucherType: string;
  displayNumber: string;
  date: string;
  /** The bill total, or for a receipt or payment the amount moved on this party's account. */
  amountPaise: Paise;
}

const BILL_TYPES = [
  'sales',
  'sales_return',
  'credit_note',
  'purchase',
  'purchase_return',
  'debit_note',
] as const;

/** One customer or supplier on one page: what they owe, what is late, and the latest activity. */
export function partySummary(db: Db, accountId: number, asOn: string): PartySummary {
  const account = db
    .prepare(
      `WITH RECURSIVE tree(id, root) AS (
         SELECT id, name FROM account_group WHERE name IN ('Sundry Debtors', 'Sundry Creditors')
         UNION ALL SELECT g.id, t.root FROM account_group g JOIN tree t ON g.parent_id = t.id)
       SELECT a.id, a.name, a.gstin, a.phone, a.address, a.state_code, a.credit_days,
              (SELECT root FROM tree WHERE tree.id = a.group_id) AS root
       FROM account a WHERE a.id = ?`,
    )
    .get(accountId);
  if (!account) throw new ValidationError('That customer or supplier no longer exists.');
  if (account['root'] === null) {
    throw new ValidationError('A summary is available for customers and suppliers only.');
  }
  const kind = account['root'] === 'Sundry Debtors' ? 'customer' : 'supplier';

  const open = outstanding(db, {
    asOn,
    side: kind === 'customer' ? 'receivable' : 'payable',
  }).find((p) => p.accountId === accountId);
  const overdue = (open?.bills ?? []).filter((b) => b.isOverdue);
  const oldest = overdue[0];

  const bills = db
    .prepare(
      `SELECT v.id, v.voucher_type, s.prefix, v.number, v.date, v.total_paise
       FROM voucher v JOIN voucher_series s ON s.id = v.series_id
       WHERE v.party_account_id = ? AND v.status = 'posted' AND v.date <= ?
         AND v.voucher_type IN (${BILL_TYPES.map(() => '?').join(', ')})
       ORDER BY v.date DESC, v.id DESC LIMIT 5`,
    )
    .all(accountId, asOn, ...BILL_TYPES);
  const payments = db
    .prepare(
      `SELECT v.id, v.voucher_type, s.prefix, v.number, v.date,
              ABS(SUM(j.dr_paise) - SUM(j.cr_paise)) AS moved
       FROM voucher v JOIN voucher_series s ON s.id = v.series_id
       JOIN journal_line j ON j.voucher_id = v.id AND j.account_id = ? AND j.is_reversal = 0
       WHERE v.voucher_type IN ('receipt', 'payment') AND v.status = 'posted' AND v.date <= ?
       GROUP BY v.id ORDER BY v.date DESC, v.id DESC LIMIT 5`,
    )
    .all(accountId, asOn);

  const row = (r: Record<string, unknown>, amount: unknown): SummaryVoucher => ({
    id: Number(r['id']),
    voucherType: String(r['voucher_type']),
    displayNumber: `${String(r['prefix'])}${Number(r['number'])}`,
    date: String(r['date']),
    amountPaise: Number(amount),
  });

  return {
    id: Number(account['id']),
    name: String(account['name']),
    kind,
    gstin: account['gstin'] === null ? null : String(account['gstin']),
    phone: account['phone'] === null ? null : String(account['phone']),
    address: account['address'] === null ? null : String(account['address']),
    stateCode: account['state_code'] === null ? null : String(account['state_code']),
    creditDays: Number(account['credit_days']),
    balancePaise: accountBalance(db, accountId, asOn),
    outstandingPaise: open?.outstandingPaise ?? 0,
    advancePaise: open?.advancePaise ?? 0,
    overduePaise: overdue.reduce((t, b) => t + b.amountPaise, 0),
    oldestOverdue: oldest
      ? {
          label: oldest.voucherId === null ? 'Opening balance' : `Bill ${String(oldest.number)}`,
          date: oldest.date,
          ageDays: oldest.ageDays,
          amountPaise: oldest.amountPaise,
        }
      : null,
    recentBills: bills.map((r) => row(r, r['total_paise'])),
    recentPayments: payments.map((r) => row(r, r['moved'])),
  };
}
