import type { Db } from '../../db/connection.ts';
import type { BasisPoints, Milli, Paise } from '../../money.ts';

/** GST state / UT codes and names, as used in "Place of Supply" on returns. */
export const STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction',
};

export function placeOfSupplyLabel(code: string): string {
  return `${code}-${STATE_NAMES[code] ?? 'Unknown'}`;
}

/** Unit quantity codes used on the HSN summary. */
const UQC: Record<string, string> = {
  pcs: 'PCS',
  nos: 'NOS',
  metre: 'MTR',
  meter: 'MTR',
  mtr: 'MTR',
  kg: 'KGS',
  kgs: 'KGS',
  ltr: 'LTR',
  litre: 'LTR',
  box: 'BOX',
  set: 'SET',
  pair: 'PRS',
  roll: 'ROL',
  bag: 'BAG',
  feet: 'OTH',
};
export const unitCode = (unitName: string): string => UQC[unitName.trim().toLowerCase()] ?? 'OTH';

export type GstPeriod = { from: string; to: string };

/** Month (1-12) or quarter (1-4) of the financial year starting in `fyStartYear`. */
export function gstPeriod(
  kind: 'month' | 'quarter',
  fyStartYear: number,
  index: number,
): GstPeriod {
  const monthsFromApril = kind === 'month' ? index - 1 : (index - 1) * 3;
  const span = kind === 'month' ? 1 : 3;
  if (monthsFromApril < 0 || monthsFromApril + span > 12) throw new RangeError('Invalid period');
  const start = new Date(Date.UTC(fyStartYear, 3 + monthsFromApril, 1));
  const end = new Date(Date.UTC(fyStartYear, 3 + monthsFromApril + span, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end) };
}

/** 2026-10-05 -> 05-Oct-26, the date format of the GST offline tool. */
export function offlineDate(iso: string): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const [y, m, d] = iso.split('-');
  return `${d}-${months[Number(m) - 1]}-${y?.slice(2)}`;
}

export interface GstLine {
  voucherId: number;
  voucherType: 'sales' | 'sales_return' | 'purchase' | 'purchase_return';
  docNumber: string;
  date: string;
  partyName: string | null;
  gstin: string | null;
  /** State code of the place of supply. */
  pos: string;
  voucherTotalPaise: Paise;
  refDocNumber: string | null;
  refDate: string | null;
  hsn: string | null;
  unit: string;
  rateBp: BasisPoints;
  /** +1 for invoices, -1 for returns, so sums are net. */
  sign: 1 | -1;
  qty: Milli;
  amountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
}

export function companyStateCode(db: Db): string {
  const row = db.prepare("SELECT value FROM setting WHERE key = 'company.state_code'").get();
  return row ? String(row['value']) : '33';
}

export function isRegistered(gstin: string | null): boolean {
  return gstin !== null && gstin.trim() !== '';
}

/** All posted item lines of the four item-voucher types in a period. */
export function gstLines(db: Db, period: GstPeriod): GstLine[] {
  const home = companyStateCode(db);
  return db
    .prepare(
      `SELECT v.id, v.voucher_type, s.prefix, v.number, v.date, v.total_paise,
              a.name AS party, a.gstin, a.state_code,
              r.date AS ref_date, rs.prefix AS ref_prefix, r.number AS ref_number,
              vi.hsn, u.name AS unit, vi.tax_rate_bp, vi.qty, vi.amount_paise, vi.taxable_paise,
              vi.cgst_paise, vi.sgst_paise, vi.igst_paise
       FROM voucher v
       JOIN voucher_item vi ON vi.voucher_id = v.id
       JOIN voucher_series s ON s.id = v.series_id
       JOIN unit u ON u.id = vi.unit_id
       LEFT JOIN account a ON a.id = v.party_account_id
       LEFT JOIN voucher r ON r.id = v.ref_voucher_id
       LEFT JOIN voucher_series rs ON rs.id = r.series_id
       WHERE v.status = 'posted'
         AND v.voucher_type IN ('sales', 'sales_return', 'purchase', 'purchase_return')
         AND v.date BETWEEN ? AND ?
       ORDER BY v.date, v.id, vi.line_no`,
    )
    .all(period.from, period.to)
    .map((r): GstLine => {
      const type = String(r['voucher_type']) as GstLine['voucherType'];
      return {
        voucherId: Number(r['id']),
        voucherType: type,
        docNumber: `${String(r['prefix'])}${Number(r['number'])}`,
        date: String(r['date']),
        partyName: r['party'] === null ? null : String(r['party']),
        gstin: r['gstin'] === null ? null : String(r['gstin']),
        pos: r['state_code'] === null ? home : String(r['state_code']),
        voucherTotalPaise: Number(r['total_paise']),
        refDocNumber:
          r['ref_number'] === null ? null : `${String(r['ref_prefix'])}${Number(r['ref_number'])}`,
        refDate: r['ref_date'] === null ? null : String(r['ref_date']),
        hsn: r['hsn'] === null ? null : String(r['hsn']),
        unit: String(r['unit']),
        rateBp: Number(r['tax_rate_bp']),
        sign: type === 'sales_return' || type === 'purchase_return' ? -1 : 1,
        qty: Number(r['qty']),
        amountPaise: Number(r['amount_paise']),
        taxablePaise: Number(r['taxable_paise']),
        cgstPaise: Number(r['cgst_paise']),
        sgstPaise: Number(r['sgst_paise']),
        igstPaise: Number(r['igst_paise']),
      };
    });
}

export const ratePercent = (bp: BasisPoints): string => (bp / 100).toFixed(2).replace(/\.?0+$/, '');
