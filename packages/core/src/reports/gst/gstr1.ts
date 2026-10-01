import type { Db } from '../../db/connection.ts';
import { formatMoney, formatQty, type BasisPoints, type Paise } from '../../money.ts';
import { toCsv } from '../csv.ts';
import {
  companyStateCode,
  gstLines,
  isRegistered,
  offlineDate,
  placeOfSupplyLabel,
  ratePercent,
  unitCode,
  type GstLine,
  type GstPeriod,
} from './common.ts';

/** Invoice value above which an unregistered inter-state sale is reported in table 5, not 7. */
const B2C_LARGE_LIMIT_PAISE = 250_000_00;

export interface InvoiceRateRow {
  voucherId: number;
  gstin: string;
  partyName: string;
  docNumber: string;
  date: string;
  invoiceValuePaise: Paise;
  pos: string;
  rateBp: BasisPoints;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
}
export interface B2cRow {
  pos: string;
  rateBp: BasisPoints;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
}
export interface NoteRow extends InvoiceRateRow {
  refDocNumber: string | null;
  refDate: string | null;
  /** 'cdnr' for registered recipients, 'cdnur' for large inter-state notes to unregistered ones. */
  kind: 'cdnr' | 'cdnur';
}
export interface NilRatedRow {
  description: string;
  taxablePaise: Paise;
}
export interface HsnRow {
  hsn: string;
  uqc: string;
  rateBp: BasisPoints;
  qty: number;
  valuePaise: Paise;
  taxablePaise: Paise;
  igstPaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
}
export interface DocumentsRow {
  nature: string;
  from: string;
  to: string;
  total: number;
  cancelled: number;
}
export interface Gstr1 {
  period: GstPeriod;
  /** Table 4: taxable supplies to registered persons. */
  b2b: InvoiceRateRow[];
  /** Table 5: inter-state taxable supplies to unregistered persons above the large-invoice limit. */
  b2cl: InvoiceRateRow[];
  /**
   * Table 7: all other taxable supplies to unregistered persons, by place of supply and rate.
   * Credit notes against these invoices reduce the figures here and are not listed separately.
   */
  b2cs: B2cRow[];
  /** Table 9B: credit notes to registered persons (cdnr) and against table 5 invoices (cdnur). */
  notes: NoteRow[];
  /** Table 8: nil-rated and exempt supplies, net of returns. Nil-rated and exempt are not told apart. */
  nilRated: NilRatedRow[];
  /** Table 12: HSN summary of outward supplies, net of returns. */
  hsn: HsnRow[];
  /** Table 13: documents issued, including cancelled numbers. */
  documents: DocumentsRow[];
}

export function gstr1(db: Db, period: GstPeriod): Gstr1 {
  const home = companyStateCode(db);
  const all = gstLines(db, period).filter(
    (l) => l.voucherType === 'sales' || l.voucherType === 'sales_return',
  );
  const taxed = all.filter((l) => l.rateBp > 0);
  const invoices = taxed.filter((l) => l.voucherType === 'sales');
  const notes = taxed.filter((l) => l.voucherType === 'sales_return');

  const isInterState = (l: GstLine) => l.pos !== '' && l.pos !== home;
  // an invoice is "large" on its own value; a credit note follows the invoice it refers to
  const isLarge = (l: GstLine) =>
    isInterState(l) && (l.refTotalPaise ?? l.voucherTotalPaise) > B2C_LARGE_LIMIT_PAISE;

  const perInvoiceRate = (src: GstLine[]) => {
    const map = new Map<string, InvoiceRateRow>();
    for (const l of src) {
      const key = `${l.voucherId}|${l.rateBp}`;
      const row =
        map.get(key) ??
        ({
          voucherId: l.voucherId,
          gstin: l.gstin ?? '',
          partyName: l.partyName ?? '',
          docNumber: l.docNumber,
          date: l.date,
          invoiceValuePaise: l.voucherTotalPaise,
          pos: l.pos,
          rateBp: l.rateBp,
          taxablePaise: 0,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 0,
        } satisfies InvoiceRateRow);
      row.taxablePaise += l.taxablePaise;
      row.cgstPaise += l.cgstPaise;
      row.sgstPaise += l.sgstPaise;
      row.igstPaise += l.igstPaise;
      map.set(key, row);
    }
    return [...map.values()];
  };

  const registeredInvoices = invoices.filter((l) => isRegistered(l.gstin));
  const unregisteredInvoices = invoices.filter((l) => !isRegistered(l.gstin));
  const registeredNotes = notes.filter((l) => isRegistered(l.gstin));
  const unregisteredNotes = notes.filter((l) => !isRegistered(l.gstin));
  const largeInvoices = unregisteredInvoices.filter(isLarge);
  const largeNotes = unregisteredNotes.filter(isLarge);

  // table 7: small unregistered invoices, less notes against such invoices
  const b2cs = new Map<string, B2cRow>();
  const smallInvoices = unregisteredInvoices.filter((l) => !isLarge(l));
  const smallNotes = unregisteredNotes.filter((l) => !isLarge(l));
  for (const l of [...smallInvoices, ...smallNotes]) {
    const key = `${l.pos}|${l.rateBp}`;
    const row =
      b2cs.get(key) ??
      ({
        pos: l.pos || home,
        rateBp: l.rateBp,
        taxablePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
      } satisfies B2cRow);
    row.taxablePaise += l.sign * l.taxablePaise;
    row.cgstPaise += l.sign * l.cgstPaise;
    row.sgstPaise += l.sign * l.sgstPaise;
    row.igstPaise += l.sign * l.igstPaise;
    b2cs.set(key, row);
  }

  const noteRows = (src: GstLine[], kind: NoteRow['kind']): NoteRow[] =>
    perInvoiceRate(src).map((r) => {
      const l = src.find((x) => x.voucherId === r.voucherId)!;
      return { ...r, refDocNumber: l.refDocNumber, refDate: l.refDate, kind };
    });

  const nilBuckets = new Map<string, number>();
  for (const l of all.filter((x) => x.rateBp === 0)) {
    const where = isInterState(l) ? 'Inter-State' : 'Intra-State';
    const who = isRegistered(l.gstin) ? 'registered' : 'unregistered';
    const key = `${where} supplies to ${who} persons`;
    nilBuckets.set(key, (nilBuckets.get(key) ?? 0) + l.sign * l.taxablePaise);
  }
  const nilRated = [
    'Inter-State supplies to registered persons',
    'Intra-State supplies to registered persons',
    'Inter-State supplies to unregistered persons',
    'Intra-State supplies to unregistered persons',
  ].map((description) => ({ description, taxablePaise: nilBuckets.get(description) ?? 0 }));

  const hsn = new Map<string, HsnRow>();
  for (const l of all) {
    const uqc = unitCode(l.unit);
    const key = `${l.hsn ?? ''}|${uqc}|${l.rateBp}`;
    const row =
      hsn.get(key) ??
      ({
        hsn: l.hsn ?? '',
        uqc,
        rateBp: l.rateBp,
        qty: 0,
        valuePaise: 0,
        taxablePaise: 0,
        igstPaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
      } satisfies HsnRow);
    row.qty += l.sign * l.qty;
    row.valuePaise += l.sign * (l.taxablePaise + l.cgstPaise + l.sgstPaise + l.igstPaise);
    row.taxablePaise += l.sign * l.taxablePaise;
    row.igstPaise += l.sign * l.igstPaise;
    row.cgstPaise += l.sign * l.cgstPaise;
    row.sgstPaise += l.sign * l.sgstPaise;
    hsn.set(key, row);
  }

  const documents = db
    .prepare(
      `SELECT v.voucher_type, s.prefix, s.name, MIN(v.number) AS lo, MAX(v.number) AS hi,
              COUNT(*) AS total, SUM(v.status = 'cancelled') AS cancelled
       FROM voucher v JOIN voucher_series s ON s.id = v.series_id
       WHERE v.voucher_type IN ('sales', 'sales_return', 'credit_note') AND v.status <> 'draft'
         AND v.date BETWEEN ? AND ?
       GROUP BY v.voucher_type, v.series_id, v.fy_id
       ORDER BY CASE v.voucher_type WHEN 'sales' THEN 0 ELSE 1 END, v.voucher_type, s.name`,
    )
    .all(period.from, period.to)
    .map((r): DocumentsRow => ({
      nature: r['voucher_type'] === 'sales' ? 'Invoices for outward supply' : 'Credit Note',
      from: `${String(r['prefix'])}${Number(r['lo'])}`,
      to: `${String(r['prefix'])}${Number(r['hi'])}`,
      total: Number(r['total']),
      cancelled: Number(r['cancelled']),
    }));

  return {
    period,
    b2b: perInvoiceRate(registeredInvoices),
    b2cl: perInvoiceRate(largeInvoices),
    b2cs: [...b2cs.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.rateBp - b.rateBp),
    notes: [...noteRows(registeredNotes, 'cdnr'), ...noteRows(largeNotes, 'cdnur')],
    nilRated,
    hsn: [...hsn.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rateBp - b.rateBp),
    documents,
  };
}

const m = (p: Paise) => formatMoney(p);

/** CSV files named as in the GST offline tool; headers should be re-checked with the CA before filing. */
export function gstr1ToCsvFiles(r: Gstr1): Record<string, string> {
  const cdnr = r.notes.filter((x) => x.kind === 'cdnr');
  const cdnur = r.notes.filter((x) => x.kind === 'cdnur');
  return {
    'b2b.csv': toCsv(
      [
        'GSTIN/UIN of Recipient',
        'Receiver Name',
        'Invoice Number',
        'Invoice date',
        'Invoice Value',
        'Place Of Supply',
        'Reverse Charge',
        'Applicable % of Tax Rate',
        'Invoice Type',
        'E-Commerce GSTIN',
        'Rate',
        'Taxable Value',
        'Cess Amount',
      ],
      r.b2b.map((x) => [
        x.gstin,
        x.partyName,
        x.docNumber,
        offlineDate(x.date),
        m(x.invoiceValuePaise),
        placeOfSupplyLabel(x.pos),
        'N',
        '',
        'Regular B2B',
        '',
        ratePercent(x.rateBp),
        m(x.taxablePaise),
        '0.00',
      ]),
    ),
    'b2cl.csv': toCsv(
      [
        'Invoice Number',
        'Invoice date',
        'Invoice Value',
        'Place Of Supply',
        'Applicable % of Tax Rate',
        'Rate',
        'Taxable Value',
        'Cess Amount',
        'E-Commerce GSTIN',
      ],
      r.b2cl.map((x) => [
        x.docNumber,
        offlineDate(x.date),
        m(x.invoiceValuePaise),
        placeOfSupplyLabel(x.pos),
        '',
        ratePercent(x.rateBp),
        m(x.taxablePaise),
        '0.00',
        '',
      ]),
    ),
    'b2cs.csv': toCsv(
      [
        'Type',
        'Place Of Supply',
        'Applicable % of Tax Rate',
        'Rate',
        'Taxable Value',
        'Cess Amount',
        'E-Commerce GSTIN',
      ],
      r.b2cs.map((x) => [
        'OE',
        placeOfSupplyLabel(x.pos),
        '',
        ratePercent(x.rateBp),
        m(x.taxablePaise),
        '0.00',
        '',
      ]),
    ),
    'cdnr.csv': toCsv(
      [
        'GSTIN/UIN of Recipient',
        'Receiver Name',
        'Note Number',
        'Note Date',
        'Note Type',
        'Place Of Supply',
        'Reverse Charge',
        'Note Supply Type',
        'Note Value',
        'Applicable % of Tax Rate',
        'Rate',
        'Taxable Value',
        'Cess Amount',
        'Original Invoice Number',
        'Original Invoice Date',
      ],
      cdnr.map((x) => [
        x.gstin,
        x.partyName,
        x.docNumber,
        offlineDate(x.date),
        'C',
        placeOfSupplyLabel(x.pos),
        'N',
        'Regular B2B',
        m(x.invoiceValuePaise),
        '',
        ratePercent(x.rateBp),
        m(x.taxablePaise),
        '0.00',
        x.refDocNumber,
        x.refDate ? offlineDate(x.refDate) : '',
      ]),
    ),
    'cdnur.csv': toCsv(
      [
        'UR Type',
        'Note Number',
        'Note Date',
        'Note Type',
        'Place Of Supply',
        'Note Value',
        'Applicable % of Tax Rate',
        'Rate',
        'Taxable Value',
        'Cess Amount',
        'Original Invoice Number',
        'Original Invoice Date',
      ],
      cdnur.map((x) => [
        'B2CL',
        x.docNumber,
        offlineDate(x.date),
        'C',
        placeOfSupplyLabel(x.pos),
        m(x.invoiceValuePaise),
        '',
        ratePercent(x.rateBp),
        m(x.taxablePaise),
        '0.00',
        x.refDocNumber,
        x.refDate ? offlineDate(x.refDate) : '',
      ]),
    ),
    'exemp.csv': toCsv(
      [
        'Description',
        'Nil Rated Supplies',
        'Exempted (other than nil rated/non GST supply)',
        'Non-GST supplies',
      ],
      r.nilRated.map((x) => [x.description, m(x.taxablePaise), '0.00', '0.00']),
    ),
    'hsn.csv': toCsv(
      [
        'HSN',
        'Description',
        'UQC',
        'Total Quantity',
        'Total Value',
        'Taxable Value',
        'Integrated Tax Amount',
        'Central Tax Amount',
        'State/UT Tax Amount',
        'Cess Amount',
        'Rate',
      ],
      r.hsn.map((x) => [
        x.hsn,
        '',
        x.uqc,
        formatQty(x.qty),
        m(x.valuePaise),
        m(x.taxablePaise),
        m(x.igstPaise),
        m(x.cgstPaise),
        m(x.sgstPaise),
        '0.00',
        ratePercent(x.rateBp),
      ]),
    ),
    'docs.csv': toCsv(
      ['Nature of Document', 'Sr. No. From', 'Sr. No. To', 'Total Number', 'Cancelled'],
      r.documents.map((x) => [x.nature, x.from, x.to, x.total, x.cancelled]),
    ),
  };
}
