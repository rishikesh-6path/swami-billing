/*
 * Formatting and parsing at the edge of the UI. Money is integer paise and quantity is integer
 * thousandths everywhere else; these helpers use only integer and string operations.
 */

/** Indian digit grouping: 1234567 -> "12,34,567". */
function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/** 236500 -> "2,365.00". */
export function formatMoney(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const frac = String(abs - whole * 100).padStart(2, '0');
  return `${sign}${groupIndian(String(whole))}.${frac}`;
}

/** Like formatMoney but with the rupee sign. */
export const rupees = (paise: number): string => `₹${formatMoney(paise)}`;

/** Ledger balance: positive is Dr (owed to us), negative is Cr. */
export function formatBalance(signedPaise: number): string {
  if (signedPaise === 0) return '0.00';
  return `${formatMoney(Math.abs(signedPaise))} ${signedPaise > 0 ? 'Dr' : 'Cr'}`;
}

/** 127050 -> "127.05"; whole numbers drop the decimals (3000 -> "3"). */
export function formatQty(milli: number): string {
  const sign = milli < 0 ? '-' : '';
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / 1000);
  const frac = String(abs - whole * 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return `${sign}${whole}${frac ? `.${frac}` : ''}`;
}

function parseScaled(text: string, decimals: number): number | null {
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text.trim().replace(/,/g, ''));
  if (!match || ((match[2] ?? '') === '' && (match[3] ?? '') === '')) return null;
  const frac = match[3] ?? '';
  if (frac.length > decimals) return null;
  const value =
    Number(match[2] || '0') * 10 ** decimals + Number(frac.padEnd(decimals, '0') || '0');
  return match[1] === '-' ? -value : value;
}

/** "45", "45.5" or "1,234.50" -> paise; null when it is not a valid amount. */
export const parseMoney = (text: string): number | null => parseScaled(text, 2);

/** "3" or "127.05" -> thousandths; null when invalid (more than 3 decimals). */
export const parseQty = (text: string): number | null => parseScaled(text, 3);

/** "18" or "12.5" -> basis points. */
export function parsePercent(text: string): number | null {
  const v = parseScaled(text.replace('%', ''), 2);
  return v;
}

export function formatPercent(bp: number): string {
  return `${bp % 100 === 0 ? bp / 100 : (bp / 100).toFixed(2).replace(/0$/, '')}%`;
}

/** 2026-10-05 -> "05-10-2026". */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/** "05-10-2026" or "5/10/26" or "05102026" -> 2026-10-05, using `today` for any missing part. */
export function parseDateInput(text: string, today: string): string | null {
  const t = text.trim();
  if (t === '') return null;
  const [ty, tm] = today.split('-');
  let d: string | undefined;
  let m: string | undefined;
  let y: string | undefined;
  const parts = t.split(/[-/. ]+/).filter(Boolean);
  if (parts.length >= 2) {
    [d, m, y] = parts;
  } else if (/^\d{1,2}$/.test(t)) {
    d = t;
  } else if (/^\d{6,8}$/.test(t)) {
    d = t.slice(0, 2);
    m = t.slice(2, 4);
    y = t.slice(4);
  }
  if (!d) return null;
  const year = y === undefined ? ty! : y.length === 2 ? `20${y}` : y;
  const month = (m ?? tm!).padStart(2, '0');
  const iso = `${year}-${month}-${d.padStart(2, '0')}`;
  const check = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === iso ? iso : null;
}

export const VOUCHER_LABELS: Record<string, string> = {
  sales: 'Sales',
  sales_return: 'Sales Return',
  purchase: 'Purchase',
  purchase_return: 'Purchase Return',
  receipt: 'Receipt',
  payment: 'Payment',
  journal: 'Journal',
  contra: 'Contra',
  debit_note: 'Debit Note',
  credit_note: 'Credit Note',
  stock_journal: 'Stock Journal',
  physical_stock: 'Physical Stock',
};
