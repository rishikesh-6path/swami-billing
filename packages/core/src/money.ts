/**
 * Money is integer paise; quantity is integer thousandths; rates and discounts are integer
 * basis points (1800 = 18%). No floats anywhere: every division rounds half away from zero.
 */

export type Paise = number;
export type Milli = number;
export type BasisPoints = number;

function assertInt(n: number, what: string): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} must be a safe integer, got ${n}`);
}

/** Integer division rounding half away from zero. `d` must be positive. */
export function divRound(n: number, d: number): number {
  assertInt(n, 'numerator');
  assertInt(d, 'denominator');
  if (d <= 0) throw new RangeError('denominator must be positive');
  const abs = Math.abs(n);
  const q = Math.floor(abs / d);
  const r = abs - q * d;
  const rounded = r * 2 >= d ? q + 1 : q;
  return n < 0 && rounded !== 0 ? -rounded : rounded; // never return -0
}

/** a x b / d rounded half away from zero, using BigInt so large intermediates cannot lose precision. */
export function mulDivRound(a: number, b: number, d: number): number {
  assertInt(a, 'operand');
  assertInt(b, 'operand');
  const product = BigInt(a) * BigInt(b);
  const denom = BigInt(d);
  const neg = product < 0n;
  const abs = neg ? -product : product;
  const q = abs / denom;
  const rounded = (abs - q * denom) * 2n >= denom ? q + 1n : q;
  const result = Number(neg ? -rounded : rounded);
  assertInt(result, 'result');
  return result;
}

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

function parseScaled(text: string, decimals: number, what: string): number {
  const match = DECIMAL.exec(text.trim());
  if (!match) throw new SyntaxError(`Invalid ${what}: "${text}"`);
  const [, sign, whole, frac = ''] = match;
  if (frac.length > decimals) {
    throw new SyntaxError(`${what} "${text}" has more than ${decimals} decimal places`);
  }
  const scaled = Number(whole) * 10 ** decimals + Number(frac.padEnd(decimals, '0'));
  assertInt(scaled, what);
  return sign === '-' ? -scaled : scaled;
}

function formatScaled(value: number, decimals: number): string {
  assertInt(value, 'value');
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const scale = 10 ** decimals;
  const whole = Math.floor(abs / scale);
  const frac = String(abs - whole * scale).padStart(decimals, '0');
  return `${sign}${whole}.${frac}`;
}

/** "12.5" -> 1250 paise. Rejects more than 2 decimal places rather than rounding silently. */
export function parseMoney(text: string): Paise {
  return parseScaled(text, 2, 'amount');
}

/** 1250 -> "12.50". Plain digits; Indian digit grouping is a UI concern. */
export function formatMoney(paise: Paise): string {
  return formatScaled(paise, 2);
}

/** "127.05" -> 127050 thousandths. */
export function parseQty(text: string): Milli {
  return parseScaled(text, 3, 'quantity');
}

/** 127050 -> "127.050". */
export function formatQty(milli: Milli): string {
  return formatScaled(milli, 3);
}

/** Line amount: quantity (thousandths) x unit price (paise) -> paise. */
export function lineAmount(qty: Milli, price: Paise): Paise {
  return mulDivRound(qty, price, 1000);
}

/** Price after a percentage discount given in basis points (1250 = 12.5%). */
export function applyDiscount(price: Paise, discBp: BasisPoints): Paise {
  if (discBp < 0 || discBp > 10000) throw new RangeError('discount must be 0..10000 bp');
  return mulDivRound(price, 10000 - discBp, 10000);
}

/** Tax on a taxable amount at a rate in basis points. */
export function taxOn(taxable: Paise, rateBp: BasisPoints): Paise {
  if (rateBp < 0) throw new RangeError('rate must not be negative');
  return mulDivRound(taxable, rateBp, 10000);
}

/**
 * One half (CGST or SGST) of intra-state tax: taxable x rate / 2, rounded to the paisa.
 * CGST and SGST are each computed this way, so they are always equal and the invoice's
 * rate-wise tax table is symmetric (a total of 9 paise at 18% on 50 paise becomes 5 + 5).
 */
export function halfTaxOn(taxable: Paise, rateBp: BasisPoints): Paise {
  if (rateBp < 0) throw new RangeError('rate must not be negative');
  return mulDivRound(taxable, rateBp, 20000);
}

/** Difference needed to round an amount to the nearest whole rupee (half away from zero). */
export function roundOffToRupee(total: Paise): Paise {
  return divRound(total, 100) * 100 - total;
}
