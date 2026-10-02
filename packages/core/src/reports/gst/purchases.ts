import type { Db } from '../../db/connection.ts';
import type { BasisPoints, Paise } from '../../money.ts';
import { formatMoneyOrEmpty, toCsv } from '../csv.ts';
import {
  gstLines,
  offlineDate,
  placeOfSupplyLabel,
  ratePercent,
  type GstPeriod,
} from './common.ts';

export interface PurchaseForCaRow {
  voucherId: number;
  supplierGstin: string;
  supplierName: string;
  /** The supplier's own invoice number, or ShopLedger's number when none was entered. */
  invoiceNumber: string;
  invoiceDate: string;
  /** Purchase, Purchase Return or Debit Note. */
  kind: string;
  entryNumber: string;
  entryDate: string;
  placeOfSupply: string;
  rateBp: BasisPoints;
  /** Returns and debit notes carry negative amounts so totals are net. */
  taxablePaise: Paise;
  igstPaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
}

export interface PurchasesForCa {
  period: GstPeriod;
  rows: PurchaseForCaRow[];
  totals: { taxablePaise: Paise; igstPaise: Paise; cgstPaise: Paise; sgstPaise: Paise };
}

const KIND: Record<string, string> = {
  purchase: 'Purchase',
  purchase_return: 'Purchase return',
  debit_note: 'Debit note',
};

/**
 * Purchases with the supplier's own invoice number and date, one row per invoice and GST rate, for
 * the accountant to match against the supplier's filings (GSTR-2B). Returns and debit notes are
 * negative. Cancelled bills are left out.
 */
export function gstPurchases(db: Db, period: GstPeriod): PurchasesForCa {
  const map = new Map<string, PurchaseForCaRow>();
  for (const l of gstLines(db, period)) {
    if (
      l.voucherType !== 'purchase' &&
      l.voucherType !== 'purchase_return' &&
      l.voucherType !== 'debit_note'
    ) {
      continue;
    }
    const key = `${l.voucherId}|${l.rateBp}`;
    const row =
      map.get(key) ??
      ({
        voucherId: l.voucherId,
        supplierGstin: l.gstin ?? '',
        supplierName: l.partyName ?? '',
        invoiceNumber: l.partyBillNo ?? l.docNumber,
        invoiceDate: l.partyBillDate ?? l.date,
        kind: KIND[l.voucherType] ?? l.voucherType,
        entryNumber: l.docNumber,
        entryDate: l.date,
        placeOfSupply: l.pos,
        rateBp: l.rateBp,
        taxablePaise: 0,
        igstPaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
      } satisfies PurchaseForCaRow);
    row.taxablePaise += l.sign * l.taxablePaise;
    row.igstPaise += l.sign * l.igstPaise;
    row.cgstPaise += l.sign * l.cgstPaise;
    row.sgstPaise += l.sign * l.sgstPaise;
    map.set(key, row);
  }
  const rows = [...map.values()].sort(
    (a, b) =>
      a.entryDate.localeCompare(b.entryDate) || a.voucherId - b.voucherId || a.rateBp - b.rateBp,
  );
  const sum = (pick: (r: PurchaseForCaRow) => number) => rows.reduce((t, r) => t + pick(r), 0);
  return {
    period,
    rows,
    totals: {
      taxablePaise: sum((r) => r.taxablePaise),
      igstPaise: sum((r) => r.igstPaise),
      cgstPaise: sum((r) => r.cgstPaise),
      sgstPaise: sum((r) => r.sgstPaise),
    },
  };
}

export function gstPurchasesToCsv(p: PurchasesForCa): string {
  const f = formatMoneyOrEmpty;
  return toCsv(
    [
      'GSTIN of supplier',
      'Supplier',
      'Invoice number',
      'Invoice date',
      'Kind',
      'Our entry no.',
      'Our entry date',
      'Place of supply',
      'Rate %',
      'Taxable value',
      'IGST',
      'CGST',
      'SGST',
      'Total tax',
    ],
    [
      ...p.rows.map((r) => [
        r.supplierGstin,
        r.supplierName,
        r.invoiceNumber,
        offlineDate(r.invoiceDate),
        r.kind,
        r.entryNumber,
        offlineDate(r.entryDate),
        r.placeOfSupply ? placeOfSupplyLabel(r.placeOfSupply) : '',
        ratePercent(r.rateBp),
        f(r.taxablePaise),
        f(r.igstPaise),
        f(r.cgstPaise),
        f(r.sgstPaise),
        f(r.igstPaise + r.cgstPaise + r.sgstPaise),
      ]),
      [
        '',
        'Total',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        f(p.totals.taxablePaise),
        f(p.totals.igstPaise),
        f(p.totals.cgstPaise),
        f(p.totals.sgstPaise),
        f(p.totals.igstPaise + p.totals.cgstPaise + p.totals.sgstPaise),
      ],
    ],
  );
}
