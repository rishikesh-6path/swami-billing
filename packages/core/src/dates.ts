/** Shared date helpers. Dates are ISO `YYYY-MM-DD` strings; a financial year runs 1 April to 31 March. */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written YYYY-MM-DD (so 2026-02-30 and 2026-13-01 are not). */
export function isRealDate(text: string): boolean {
  if (!ISO.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** 2026-10-05 -> "05-10-2026", the way dates are written in the shop. */
export function showDate(iso: string): string {
  return iso.split('-').reverse().join('-');
}

/** First day of the financial year a date falls in: 2026-10-05 -> 2026-04-01. */
export function fyStartOf(iso: string): string {
  const year = Number(iso.slice(0, 4));
  return `${Number(iso.slice(5, 7)) >= 4 ? year : year - 1}-04-01`;
}

/** Last day of the financial year a date falls in: 2026-10-05 -> 2027-03-31. */
export function fyEndOf(iso: string): string {
  return `${Number(fyStartOf(iso).slice(0, 4)) + 1}-03-31`;
}
