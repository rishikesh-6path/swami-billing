import type { Db } from '../db/connection.ts';
import type { Paise } from '../money.ts';
import { formatMoneyOrEmpty, toCsv } from './csv.ts';

export interface RegisterRow {
  voucherId: number;
  date: string;
  voucherType: string;
  number: number;
  partyName: string | null;
  partyGstin: string | null;
  /** The supplier's own invoice number and date (purchases). */
  partyBillNo: string | null;
  partyBillDate: string | null;
  /** Returns carry negative amounts so register totals are net. */
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
  isCancelled: boolean;
}

export interface Register {
  rows: RegisterRow[];
  totals: {
    taxablePaise: Paise;
    cgstPaise: Paise;
    sgstPaise: Paise;
    igstPaise: Paise;
    totalPaise: Paise;
  };
}

function register(
  db: Db,
  positive: string,
  reducing: string[],
  args: { from: string; to: string },
): Register {
  const types = [positive, ...reducing];
  const rows = db
    .prepare(
      `SELECT v.id, v.date, v.voucher_type, v.number, a.name AS party, COALESCE(v.party_gstin, a.gstin) AS gstin,
              v.taxable_paise, v.round_off_paise, v.total_paise, v.status, v.party_bill_no, v.party_bill_date,
              COALESCE((SELECT SUM(cgst_paise) FROM voucher_item WHERE voucher_id = v.id), 0) AS cgst,
              COALESCE((SELECT SUM(sgst_paise) FROM voucher_item WHERE voucher_id = v.id), 0) AS sgst,
              COALESCE((SELECT SUM(igst_paise) FROM voucher_item WHERE voucher_id = v.id), 0) AS igst
       FROM voucher v LEFT JOIN account a ON a.id = v.party_account_id
       WHERE v.status <> 'draft' AND v.voucher_type IN (${types.map(() => '?').join(', ')}) AND v.date BETWEEN ? AND ?
       ORDER BY v.date, v.id`,
    )
    .all(...types, args.from, args.to)
    .map((r): RegisterRow => {
      const sign = String(r['voucher_type']) === positive ? 1 : -1;
      return {
        voucherId: Number(r['id']),
        date: String(r['date']),
        voucherType: String(r['voucher_type']),
        number: Number(r['number']),
        partyName: r['party'] === null ? null : String(r['party']),
        partyGstin: r['gstin'] === null ? null : String(r['gstin']),
        partyBillNo: r['party_bill_no'] === null ? null : String(r['party_bill_no']),
        partyBillDate: r['party_bill_date'] === null ? null : String(r['party_bill_date']),
        taxablePaise: sign * Number(r['taxable_paise']),
        cgstPaise: sign * Number(r['cgst']),
        sgstPaise: sign * Number(r['sgst']),
        igstPaise: sign * Number(r['igst']),
        roundOffPaise: sign * Number(r['round_off_paise']),
        totalPaise: sign * Number(r['total_paise']),
        isCancelled: r['status'] === 'cancelled',
      };
    });
  const live = rows.filter((r) => !r.isCancelled);
  const sum = (pick: (r: RegisterRow) => number) => live.reduce((t, r) => t + pick(r), 0);
  return {
    rows,
    totals: {
      taxablePaise: sum((r) => r.taxablePaise),
      cgstPaise: sum((r) => r.cgstPaise),
      sgstPaise: sum((r) => r.sgstPaise),
      igstPaise: sum((r) => r.igstPaise),
      totalPaise: sum((r) => r.totalPaise),
    },
  };
}

export const salesRegister = (db: Db, args: { from: string; to: string }) =>
  register(db, 'sales', ['sales_return', 'credit_note'], args);

export const purchaseRegister = (db: Db, args: { from: string; to: string }) =>
  register(db, 'purchase', ['purchase_return', 'debit_note'], args);

export function registerToCsv(reg: Register): string {
  return toCsv(
    [
      'Date',
      'Type',
      'Number',
      'Party',
      'GSTIN',
      'Supplier invoice no.',
      'Supplier invoice date',
      'Taxable',
      'CGST',
      'SGST',
      'IGST',
      'Total',
      'Status',
    ],
    [
      ...reg.rows.map((r) => [
        r.date,
        r.voucherType,
        r.number,
        r.partyName,
        r.partyGstin,
        r.partyBillNo,
        r.partyBillDate,
        formatMoneyOrEmpty(r.taxablePaise),
        formatMoneyOrEmpty(r.cgstPaise),
        formatMoneyOrEmpty(r.sgstPaise),
        formatMoneyOrEmpty(r.igstPaise),
        formatMoneyOrEmpty(r.totalPaise),
        r.isCancelled ? 'Cancelled' : '',
      ]),
      [
        '',
        '',
        '',
        'Total',
        '',
        '',
        '',
        formatMoneyOrEmpty(reg.totals.taxablePaise),
        formatMoneyOrEmpty(reg.totals.cgstPaise),
        formatMoneyOrEmpty(reg.totals.sgstPaise),
        formatMoneyOrEmpty(reg.totals.igstPaise),
        formatMoneyOrEmpty(reg.totals.totalPaise),
        '',
      ],
    ],
  );
}
