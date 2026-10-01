import type { Db } from '../../db/connection.ts';
import type { BasisPoints, Paise } from '../../money.ts';
import { formatMoneyOrEmpty, toCsv } from '../csv.ts';
import { gstLines, type GstPeriod } from './common.ts';

export interface TaxAmounts {
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
}
export interface RateRow extends TaxAmounts {
  rateBp: BasisPoints;
}
export interface GstSummary {
  period: GstPeriod;
  /** Outward supplies net of sales returns, by rate. */
  output: RateRow[];
  /** Purchases net of purchase returns, by rate (all input tax is treated as eligible ITC). */
  input: RateRow[];
  outputTax: { cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise; totalPaise: Paise };
  inputTax: { cgstPaise: Paise; sgstPaise: Paise; igstPaise: Paise; totalPaise: Paise };
  /** Output minus input tax. Negative means unused credit carried forward. */
  netPayablePaise: Paise;
}

const empty = (): TaxAmounts => ({ taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 });

function byRate(rows: { rateBp: number; sign: 1 | -1; t: TaxAmounts }[]): RateRow[] {
  const map = new Map<number, RateRow>();
  for (const r of rows) {
    const row = map.get(r.rateBp) ?? { rateBp: r.rateBp, ...empty() };
    row.taxablePaise += r.sign * r.t.taxablePaise;
    row.cgstPaise += r.sign * r.t.cgstPaise;
    row.sgstPaise += r.sign * r.t.sgstPaise;
    row.igstPaise += r.sign * r.t.igstPaise;
    map.set(r.rateBp, row);
  }
  return [...map.values()].sort((a, b) => a.rateBp - b.rateBp);
}

const totalTax = (rows: RateRow[]) => {
  const cgstPaise = rows.reduce((t, r) => t + r.cgstPaise, 0);
  const sgstPaise = rows.reduce((t, r) => t + r.sgstPaise, 0);
  const igstPaise = rows.reduce((t, r) => t + r.igstPaise, 0);
  return { cgstPaise, sgstPaise, igstPaise, totalPaise: cgstPaise + sgstPaise + igstPaise };
};

/** Output vs input tax for a period, built from the rates and amounts frozen on each voucher line. */
export function gstSummary(db: Db, period: GstPeriod): GstSummary {
  const lines = gstLines(db, period);
  const pick = (outward: boolean) =>
    byRate(
      lines
        .filter((l) => (l.voucherType === 'sales' || l.voucherType === 'sales_return') === outward)
        .map((l) => ({ rateBp: l.rateBp, sign: l.sign, t: l })),
    );
  const output = pick(true);
  const input = pick(false);
  const outputTax = totalTax(output);
  const inputTax = totalTax(input);
  return {
    period,
    output,
    input,
    outputTax,
    inputTax,
    netPayablePaise: outputTax.totalPaise - inputTax.totalPaise,
  };
}

export function gstSummaryToCsv(s: GstSummary): string {
  const rows = (label: string, list: RateRow[]) =>
    list.map((r) => [
      label,
      `${r.rateBp / 100}%`,
      formatMoneyOrEmpty(r.taxablePaise),
      formatMoneyOrEmpty(r.cgstPaise),
      formatMoneyOrEmpty(r.sgstPaise),
      formatMoneyOrEmpty(r.igstPaise),
    ]);
  return toCsv(
    ['Side', 'Rate', 'Taxable value', 'CGST', 'SGST', 'IGST'],
    [
      ...rows('Sales (output)', s.output),
      ...rows('Purchases (input)', s.input),
      [
        'Tax on sales',
        '',
        '',
        formatMoneyOrEmpty(s.outputTax.cgstPaise),
        formatMoneyOrEmpty(s.outputTax.sgstPaise),
        formatMoneyOrEmpty(s.outputTax.igstPaise),
      ],
      [
        'Tax paid on purchases',
        '',
        '',
        formatMoneyOrEmpty(s.inputTax.cgstPaise),
        formatMoneyOrEmpty(s.inputTax.sgstPaise),
        formatMoneyOrEmpty(s.inputTax.igstPaise),
      ],
      ['Net tax payable', '', '', '', '', formatMoneyOrEmpty(s.netPayablePaise)],
    ],
  );
}
