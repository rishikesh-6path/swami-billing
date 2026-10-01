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
  /** 'cdnr' for registered recipients, 'cdnur' otherwise. */
  kind: 'cdnr' | 'cdnur';
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
  /** Table 4: supplies to registered persons. */
  b2b: InvoiceRateRow[];
  /** Table 5: inter-state supplies to unregistered persons above the large-invoice limit. */
  b2cl: InvoiceRateRow[];
  /** Table 7: all other supplies to unregistered persons, by place of supply and rate. */
  b2cs: B2cRow[];
  /** Table 9B: credit notes. */
  notes: NoteRow[];
  /** Table 12: HSN summary of outward supplies, net of returns. */
  hsn: HsnRow[];
  /** Table 13: documents issued, including cancelled numbers. */
  documents: DocumentsRow[];
}

const sumInto = <T extends B2cRow>(map: Map<string, T>, key: string, make: () => T, l: GstLine) => {
  const row = map.get(key) ?? make();
  row.taxablePaise += l.sign * l.taxablePaise;
  row.cgstPaise += l.sign * l.cgstPaise;
  row.sgstPaise += l.sign * l.sgstPaise;
  row.igstPaise += l.sign * l.igstPaise;
  map.set(key, row);
};

export function gstr1(db: Db, period: GstPeriod): Gstr1 {
  const home = companyStateCode(db);
  const lines = gstLines(db, period).filter(
    (l) => l.voucherType === 'sales' || l.voucherType === 'sales_return',
  );
  const invoices = lines.filter((l) => l.voucherType === 'sales');
  const credit = lines.filter((l) => l.voucherType === 'sales_return');

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

  const registered = invoices.filter((l) => isRegistered(l.gstin));
  const unregistered = invoices.filter((l) => !isRegistered(l.gstin));
  const isLarge = (l: GstLine) => l.pos !== home && l.voucherTotalPaise > B2C_LARGE_LIMIT_PAISE;

  const b2cs = new Map<string, B2cRow>();
  for (const l of [
    ...unregistered.filter((l) => !isLarge(l)),
    ...credit.filter((l) => !isRegistered(l.gstin) && !isLarge(l)),
  ]) {
    sumInto(
      b2cs,
      `${l.pos}|${l.rateBp}`,
      () => ({
        pos: l.pos,
        rateBp: l.rateBp,
        taxablePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
      }),
      l,
    );
  }

  const noteRows = (src: GstLine[]): NoteRow[] =>
    perInvoiceRate(src).map((r) => {
      const l = src.find((x) => x.voucherId === r.voucherId)!;
      return {
        ...r,
        refDocNumber: l.refDocNumber,
        refDate: l.refDate,
        kind: isRegistered(l.gstin) ? 'cdnr' : 'cdnur',
      };
    });

  const hsn = new Map<string, HsnRow>();
  for (const l of lines) {
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

  const docs = db
    .prepare(
      `SELECT v.voucher_type, s.prefix, s.name, MIN(v.number) AS lo, MAX(v.number) AS hi,
              COUNT(*) AS total, SUM(v.status = 'cancelled') AS cancelled
       FROM voucher v JOIN voucher_series s ON s.id = v.series_id
       WHERE v.voucher_type IN ('sales', 'sales_return') AND v.status <> 'draft'
         AND v.date BETWEEN ? AND ?
       GROUP BY v.voucher_type, v.series_id, v.fy_id ORDER BY v.voucher_type, s.name`,
    )
    .all(period.from, period.to)
    .map((r): DocumentsRow => ({
      nature: r['voucher_type'] === 'sales' ? 'Invoices for outward supply' : 'Credit Note',
      from: `${String(r['prefix'])}${Number(r['lo'])}`,
      to: `${String(r['prefix'])}${Number(r['hi'])}`,
      total: Number(r['total']),
      cancelled: Number(r['cancelled']),
    }));

  const larges = unregistered.filter(isLarge);
  return {
    period,
    b2b: perInvoiceRate(registered),
    b2cl: perInvoiceRate(larges),
    b2cs: [...b2cs.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.rateBp - b.rateBp),
    notes: noteRows(credit),
    hsn: [...hsn.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.rateBp - b.rateBp),
    documents: docs,
  };
}

const m = (p: Paise) => formatMoney(p);

/** CSV files named as in the GST offline tool; headers should be re-checked with the CA before filing. */
export function gstr1ToCsvFiles(r: Gstr1): Record<string, string> {
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
      r.notes
        .filter((x) => x.kind === 'cdnr')
        .map((x) => [
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
