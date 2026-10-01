import { ValidationError } from '../errors.ts';
import { STATE_NAMES } from '../reports/gst/common.ts';

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The mod-36 check character for the first 14 characters of a GSTIN. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = GSTIN_CHARS.indexOf(first14.charAt(i));
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS.charAt((36 - (sum % 36)) % 36);
}

/** Validates the GSTIN layout and its mod-36 check character. */
export function isValidGstin(gstin: string): boolean {
  return GSTIN_SHAPE.test(gstin) && gstinCheckChar(gstin.slice(0, 14)) === gstin.charAt(14);
}

/** Trims and requires a non-empty name, with a friendly field label in the message. */
export function requireName(value: string | undefined, label: string): string {
  const name = (value ?? '').trim().replace(/\s+/g, ' ');
  if (name === '') throw new ValidationError(`Please enter the ${label}.`);
  if (name.length > 120)
    throw new ValidationError(`The ${label} is too long (120 letters at most).`);
  return name;
}

/** Normalises an optional GSTIN, state code and phone and checks that they agree. */
export function cleanParty(input: {
  gstin?: string | null | undefined;
  stateCode?: string | null | undefined;
  phone?: string | null | undefined;
}): { gstin: string | null; stateCode: string | null; phone: string | null } {
  const gstin = (input.gstin ?? '').trim().toUpperCase() || null;
  if (gstin !== null && !isValidGstin(gstin)) {
    throw new ValidationError(
      `The GST number "${gstin}" does not look right. Please check it against the GST certificate.`,
    );
  }
  let stateCode = (input.stateCode ?? '').trim() || null;
  if (stateCode !== null && !(stateCode in STATE_NAMES)) {
    throw new ValidationError(`"${stateCode}" is not a valid state code.`);
  }
  if (gstin !== null) {
    const fromGstin = gstin.slice(0, 2);
    if (stateCode !== null && stateCode !== fromGstin) {
      throw new ValidationError('The state does not match the first two digits of the GST number.');
    }
    stateCode = fromGstin;
  }
  const phone = (input.phone ?? '').replace(/[\s-]/g, '') || null;
  if (phone !== null && !/^\+?\d{6,15}$/.test(phone)) {
    throw new ValidationError('The phone number should have digits only (6 to 15 of them).');
  }
  return { gstin, stateCode, phone };
}

export function requireNonNegative(value: number | undefined, label: string): number {
  const n = value ?? 0;
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new ValidationError(`The ${label} cannot be negative.`);
  }
  return n;
}
