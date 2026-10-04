import { formatMoney } from '../money.ts';

export type CsvCell = string | number | null;

const NUMBER_LIKE = /^[+-]?\d[\d,]*(\.\d+)?( (Dr|Cr))?$/;
/** A phone number such as "+91 98765 43210": only digits, spaces, brackets and dashes, so it cannot be a formula. */
const PHONE_LIKE = /^\+?[\d\s()-]+$/;

function escape(cell: CsvCell): string {
  let text = cell === null ? '' : String(cell);
  // A name typed or imported as "=HYPERLINK(...)" must not run as a formula when the file is opened
  // in Excel. Numbers (including negative ones) are left alone.
  if (
    typeof cell === 'string' &&
    /^[=+\-@\t\r]/.test(text) &&
    !NUMBER_LIKE.test(text) &&
    !PHONE_LIKE.test(text)
  ) {
    text = `'${text}`;
  }
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Normalised CSV used by golden-file tests: LF line endings, no trailing spaces. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows].map((r) => r.map(escape).join(',')).join('\n') + '\n';
}

/** Dr/Cr suffix format used by Busy ledgers, e.g. "2365.00 Dr". */
export function formatBalance(signedPaise: number): string {
  if (signedPaise === 0) return '0.00';
  return `${formatMoney(Math.abs(signedPaise))} ${signedPaise > 0 ? 'Dr' : 'Cr'}`;
}

/** Money with two decimals, or an empty cell for zero (ledger columns are blank when unused). */
export function formatMoneyOrEmpty(paise: number): string {
  return paise === 0 ? '' : formatMoney(paise);
}
