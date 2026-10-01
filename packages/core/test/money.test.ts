import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyDiscount,
  divRound,
  formatMoney,
  formatQty,
  lineAmount,
  parseMoney,
  parseQty,
  roundOffToRupee,
  halfTaxOn,
  taxOn,
} from '../src/money.ts';

describe('rounding', () => {
  it('rounds half away from zero at the boundary', () => {
    expect(divRound(5, 10)).toBe(1);
    expect(divRound(4, 10)).toBe(0);
    expect(divRound(15, 10)).toBe(2);
    expect(divRound(-5, 10)).toBe(-1);
    expect(divRound(-4, 10)).toBe(0);
    expect(divRound(0, 7)).toBe(0);
  });

  it('computes tax per line to the paisa, half up', () => {
    expect(taxOn(1, 1800)).toBe(0); // 0.18 paise
    expect(taxOn(3, 1800)).toBe(1); // 0.54 paise
    expect(taxOn(100000, 1800)).toBe(18000);
    expect(taxOn(2775, 900)).toBe(250); // 249.75 -> 250
  });

  it('computes line amounts from 3-dp quantities without floats', () => {
    expect(lineAmount(127050, 1234)).toBe(156780); // 127.05 x 12.34 = 1567.797 -> 1567.80
    expect(lineAmount(1000, 99)).toBe(99);
    expect(lineAmount(1, 1)).toBe(0);
    expect(lineAmount(500, 1)).toBe(1); // 0.5 paise rounds up
  });

  it('applies percentage discounts in basis points', () => {
    expect(applyDiscount(10000, 1000)).toBe(9000);
    expect(applyDiscount(999, 1250)).toBe(874); // 874.125
    expect(() => applyDiscount(100, 10001)).toThrow(RangeError);
  });

  it('computes CGST and SGST each from half the rate, so they are always equal', () => {
    expect(halfTaxOn(50, 1800)).toBe(5); // 4.5 paise rounds up; total tax 10, not 9
    expect(halfTaxOn(10000, 1800)).toBe(900);
    expect(halfTaxOn(0, 1800)).toBe(0);
  });

  it('rounds the grand total to the nearest rupee', () => {
    expect(roundOffToRupee(10049)).toBe(-49);
    expect(roundOffToRupee(10050)).toBe(50);
    expect(roundOffToRupee(10000)).toBe(0);
  });
});

describe('parsing and formatting', () => {
  it('round-trips money and quantity text', () => {
    expect(parseMoney('12.5')).toBe(1250);
    expect(parseMoney('-0.05')).toBe(-5);
    expect(formatMoney(-5)).toBe('-0.05');
    expect(parseQty('127.05')).toBe(127050);
    expect(formatQty(127050)).toBe('127.050');
  });

  it('rejects excess precision and garbage instead of rounding silently', () => {
    expect(() => parseMoney('1.234')).toThrow(/decimal places/);
    expect(() => parseQty('1.2345')).toThrow(/decimal places/);
    expect(() => parseMoney('abc')).toThrow(SyntaxError);
    expect(() => parseMoney('')).toThrow(SyntaxError);
  });

  it('round-trips any integer paise value', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e12, max: 1e12 }), (p) => parseMoney(formatMoney(p)) === p),
      { numRuns: 500 },
    );
  });
});

describe('properties', () => {
  it('divRound is within half a unit of the exact quotient', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e9, max: 1e9 }), fc.integer({ min: 1, max: 1e6 }), (n, d) => {
        const q = divRound(n, d);
        expect(Math.abs(q * d - n) * 2).toBeLessThanOrEqual(d);
      }),
      { numRuns: 500 },
    );
  });

  it('half-rate tax is within one paisa of the exact half of the full-rate tax', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e10 }), fc.integer({ min: 0, max: 4000 }), (t, r) => {
        expect(Math.abs(2 * halfTaxOn(t, r) - taxOn(t, r))).toBeLessThanOrEqual(1);
      }),
      { numRuns: 500 },
    );
  });
});
