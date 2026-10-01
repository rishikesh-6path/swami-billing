import type { SQLOutputValue } from 'node:sqlite';
import type { Db } from '../../db/connection.ts';
import type { Milli, Paise } from '../../money.ts';
import { financialYearOn } from '../../books/financial-year.ts';
import type { VoucherSnapshot } from './types.ts';

type Row = Record<string, SQLOutputValue>;
const str = (v: SQLOutputValue | undefined): string | null =>
  v === null || v === undefined ? null : String(v);

/** The number the next voucher of this kind will get on `date` (series numbers restart each financial year). */
export function nextVoucherNumber(
  db: Db,
  voucherType: string,
  seriesId: number,
  date: string,
): number {
  const fy = financialYearOn(db, date);
  if (!fy) return 1;
  const row = db
    .prepare(
      'SELECT last_no FROM voucher_counter WHERE voucher_type = ? AND series_id = ? AND fy_id = ?',
    )
    .get(voucherType, seriesId, fy.id);
  return Number(row?.['last_no'] ?? 0) + 1;
}

function parseSnapshot(raw: unknown): VoucherSnapshot | null {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw) as VoucherSnapshot;
  } catch {
    return null;
  }
}

export interface VoucherDetail {
  id: number;
  voucherType: string;
  number: number;
  /** Series prefix and number, as printed on the bill. */
  displayNumber: string;
  seriesName: string;
  date: string;
  status: 'draft' | 'posted' | 'cancelled';
  party: {
    id: number;
    name: string;
    gstin: string | null;
    stateCode: string | null;
    address: string | null;
    phone: string | null;
  } | null;
  saleTypeName: string | null;
  broker: string | null;
  narration: string | null;
  subtotalPaise: Paise;
  taxablePaise: Paise;
  taxPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
  posStateCode: string | null;
  /** How GST was applied when the bill was made: within the state, between states, or none. */
  taxMode: 'local' | 'interstate' | 'exempt';
  /** The shop's details as they were when the bill was made (null for older entries). */
  company: VoucherSnapshot['company'];
  refVoucher: { id: number; displayNumber: string; date: string } | null;
  modifiedFromId: number | null;
  createdByName: string | null;
  createdAt: string;
  lines: {
    lineNo: number;
    itemId: number;
    itemName: string;
    alias: string | null;
    unitId: number;
    unitName: string;
    hsn: string | null;
    qty: Milli;
    listPricePaise: Paise;
    discBp: number;
    pricePaise: Paise;
    amountPaise: Paise;
    taxRateBp: number;
    taxablePaise: Paise;
    cgstPaise: Paise;
    sgstPaise: Paise;
    igstPaise: Paise;
  }[];
  sundries: { billSundryId: number; name: string; sign: 1 | -1; amountPaise: Paise }[];
  settlements: { accountId: number; accountName: string; amountPaise: Paise }[];
  /** For receipts, payments, journals and notes: the original (non-reversal) entries. */
  entries: { accountId: number; accountName: string; side: 'dr' | 'cr'; amountPaise: Paise }[];
}

export function getVoucherDetail(db: Db, id: number): VoucherDetail | undefined {
  const v: Row | undefined = db
    .prepare(
      `SELECT v.*, s.prefix, s.name AS series_name, st.name AS sale_type, u.name AS user_name,
              a.name AS party_name, a.gstin AS acc_gstin, a.state_code AS acc_state, a.address AS party_address, a.phone AS party_phone,
              r.number AS ref_number, r.date AS ref_date, rs.prefix AS ref_prefix
       FROM voucher v
       JOIN voucher_series s ON s.id = v.series_id
       LEFT JOIN sale_type st ON st.id = v.sale_type_id
       LEFT JOIN user u ON u.id = v.created_by
       LEFT JOIN account a ON a.id = v.party_account_id
       LEFT JOIN voucher r ON r.id = v.ref_voucher_id
       LEFT JOIN voucher_series rs ON rs.id = r.series_id
       WHERE v.id = ?`,
    )
    .get(id);
  if (!v) return undefined;

  const lines = db
    .prepare(
      `SELECT vi.*, i.name AS item_name, i.alias, un.name AS unit_name
       FROM voucher_item vi JOIN item i ON i.id = vi.item_id JOIN unit un ON un.id = vi.unit_id
       WHERE vi.voucher_id = ? ORDER BY vi.line_no`,
    )
    .all(id);
  const sundries = db
    .prepare(
      `SELECT vs.bill_sundry_id, vs.amount_paise, b.name, b.sign FROM voucher_sundry vs
       JOIN bill_sundry b ON b.id = vs.bill_sundry_id WHERE vs.voucher_id = ? ORDER BY vs.id`,
    )
    .all(id);
  const settlements = db
    .prepare(
      `SELECT s.account_id, s.amount_paise, a.name FROM voucher_settlement s
       JOIN account a ON a.id = s.account_id WHERE s.voucher_id = ? ORDER BY s.id`,
    )
    .all(id);
  const entries = db
    .prepare(
      `SELECT j.account_id, j.dr_paise, j.cr_paise, a.name FROM journal_line j
       JOIN account a ON a.id = j.account_id WHERE j.voucher_id = ? AND j.is_reversal = 0 ORDER BY j.line_no`,
    )
    .all(id);

  const snapshot = parseSnapshot(v['snapshot_json']);
  const partyId = v['party_account_id'];
  return {
    id: Number(v['id']),
    voucherType: String(v['voucher_type']),
    number: Number(v['number']),
    displayNumber: `${String(v['prefix'])}${Number(v['number'])}`,
    seriesName: String(v['series_name']),
    date: String(v['date']),
    status: String(v['status']) as VoucherDetail['status'],
    party:
      partyId === null
        ? null
        : {
            id: Number(partyId),
            name: snapshot?.party?.name ?? String(v['party_name']),
            // the GSTIN frozen on the bill; the customer's current one must never leak into a reprint
            gstin: str(v['party_gstin']),
            stateCode: snapshot?.party ? snapshot.party.stateCode : str(v['acc_state']),
            address: snapshot?.party ? snapshot.party.address : str(v['party_address']),
            phone: snapshot?.party ? snapshot.party.phone : str(v['party_phone']),
          },
    saleTypeName: str(v['sale_type']),
    broker: str(v['broker']),
    narration: str(v['narration']),
    subtotalPaise: Number(v['subtotal_paise']),
    taxablePaise: Number(v['taxable_paise']),
    taxPaise: Number(v['tax_paise']),
    roundOffPaise: Number(v['round_off_paise']),
    totalPaise: Number(v['total_paise']),
    posStateCode: str(v['pos_state_code']),
    taxMode:
      (str(v['tax_mode']) as VoucherDetail['taxMode'] | null) ??
      (lines.some((l) => Number(l['igst_paise']) > 0) ? 'interstate' : 'local'),
    company: snapshot?.company ?? null,
    refVoucher:
      v['ref_voucher_id'] === null
        ? null
        : {
            id: Number(v['ref_voucher_id']),
            displayNumber: `${String(v['ref_prefix'])}${Number(v['ref_number'])}`,
            date: String(v['ref_date']),
          },
    modifiedFromId: v['modified_from_id'] === null ? null : Number(v['modified_from_id']),
    createdByName: str(v['user_name']),
    createdAt: String(v['created_at']),
    lines: lines.map((l) => ({
      lineNo: Number(l['line_no']),
      itemId: Number(l['item_id']),
      itemName: snapshot?.items[String(l['item_id'])] ?? String(l['item_name']),
      alias: str(l['alias']),
      unitId: Number(l['unit_id']),
      unitName: String(l['unit_name']),
      hsn: str(l['hsn']),
      qty: Number(l['qty']),
      listPricePaise: Number(l['list_price_paise']),
      discBp: Number(l['disc_bp']),
      pricePaise: Number(l['price_paise']),
      amountPaise: Number(l['amount_paise']),
      taxRateBp: Number(l['tax_rate_bp']),
      taxablePaise: Number(l['taxable_paise']),
      cgstPaise: Number(l['cgst_paise']),
      sgstPaise: Number(l['sgst_paise']),
      igstPaise: Number(l['igst_paise']),
    })),
    sundries: sundries.map((s) => ({
      billSundryId: Number(s['bill_sundry_id']),
      name: String(s['name']),
      sign: Number(s['sign']) === -1 ? -1 : 1,
      amountPaise: Number(s['amount_paise']),
    })),
    settlements: settlements.map((s) => ({
      accountId: Number(s['account_id']),
      accountName: String(s['name']),
      amountPaise: Number(s['amount_paise']),
    })),
    entries: entries.map((e) => ({
      accountId: Number(e['account_id']),
      accountName: String(e['name']),
      side: Number(e['dr_paise']) > 0 ? 'dr' : 'cr',
      amountPaise: Number(e['dr_paise']) > 0 ? Number(e['dr_paise']) : Number(e['cr_paise']),
    })),
  };
}

export interface VoucherListRow {
  id: number;
  voucherType: string;
  displayNumber: string;
  date: string;
  partyName: string | null;
  narration: string | null;
  totalPaise: Paise;
  status: 'draft' | 'posted' | 'cancelled';
  createdByName: string | null;
}

/** Vouchers for the "find a bill" screen, newest first. `search` matches the party name, number or narration. */
export function listVouchers(
  db: Db,
  args: {
    voucherType?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    partyId?: number | undefined;
    search?: string | undefined;
    includeCancelled?: boolean | undefined;
    limit?: number | undefined;
  } = {},
): VoucherListRow[] {
  const like = `%${(args.search ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db
    .prepare(
      `SELECT v.id, v.voucher_type, s.prefix, v.number, v.date, a.name AS party, v.narration, v.total_paise,
              v.status, u.name AS user_name
       FROM voucher v JOIN voucher_series s ON s.id = v.series_id
       LEFT JOIN account a ON a.id = v.party_account_id LEFT JOIN user u ON u.id = v.created_by
       WHERE v.status <> 'draft' AND (v.status = 'posted' OR ? = 1)
         AND (? IS NULL OR v.voucher_type = ?) AND (? IS NULL OR v.date >= ?) AND (? IS NULL OR v.date <= ?)
         AND (? IS NULL OR v.party_account_id = ?)
         AND (? = '%%' OR lower(COALESCE(a.name, '')) LIKE ? ESCAPE '\\'
              OR lower(s.prefix || v.number) LIKE ? ESCAPE '\\' OR lower(COALESCE(v.narration, '')) LIKE ? ESCAPE '\\')
       ORDER BY v.date DESC, v.id DESC LIMIT ?`,
    )
    .all(
      args.includeCancelled ? 1 : 0,
      args.voucherType ?? null,
      args.voucherType ?? null,
      args.from ?? null,
      args.from ?? null,
      args.to ?? null,
      args.to ?? null,
      args.partyId ?? null,
      args.partyId ?? null,
      like,
      like,
      like,
      like,
      args.limit ?? 200,
    )
    .map((r) => ({
      id: Number(r['id']),
      voucherType: String(r['voucher_type']),
      displayNumber: `${String(r['prefix'])}${Number(r['number'])}`,
      date: String(r['date']),
      partyName: str(r['party']),
      narration: str(r['narration']),
      totalPaise: Number(r['total_paise']),
      status: String(r['status']) as VoucherListRow['status'],
      createdByName: str(r['user_name']),
    }));
}
