import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allocate, computeItemVoucher } from '../../src/domain/posting/compute.ts';

describe('allocate', () => {
  it('always sums exactly to the total', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e9, max: 1e9 }),
        fc.array(fc.integer({ min: 1, max: 1e8 }), { minLength: 1, maxLength: 12 }),
        (total, weights) => {
          const parts = allocate(total, weights);
          expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
          expect(parts.every((p) => (total >= 0 ? p >= 0 : p <= 0))).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('spreads proportionally with the largest remainder first', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
  });
});

describe('computeItemVoucher', () => {
  const line = { qty: 2000, listPricePaise: 10000, discBp: 0, taxRateBp: 1800 };

  it('computes a simple local sale with CGST/SGST and round-off', () => {
    const v = computeItemVoucher([line], [], 'local', true);
    expect(v.subtotalPaise).toBe(20000);
    expect(v.cgstPaise).toBe(1800);
    expect(v.sgstPaise).toBe(1800);
    expect(v.totalPaise).toBe(23600);
    expect(v.roundOffPaise).toBe(0);
  });

  it('uses IGST for interstate and no tax for exempt', () => {
    expect(computeItemVoucher([line], [], 'interstate', false).igstPaise).toBe(3600);
    expect(computeItemVoucher([line], [], 'exempt', false).taxPaise).toBe(0);
  });

  it('spreads a taxable discount across lines before tax', () => {
    const lines = [line, { ...line, listPricePaise: 30000 }];
    const v = computeItemVoucher(
      lines,
      [{ sign: -1, affectsTaxable: true, amountPaise: 1000 }],
      'local',
      false,
    );
    expect(v.taxablePaise).toBe(20000 + 60000 - 1000);
    expect(v.lines[0]!.taxablePaise).toBe(20000 - 250);
  });

  it('adds non-taxable sundries after tax', () => {
    const v = computeItemVoucher(
      [line],
      [{ sign: 1, affectsTaxable: false, amountPaise: 5000 }],
      'local',
      false,
    );
    expect(v.taxablePaise).toBe(20000);
    expect(v.totalPaise).toBe(20000 + 3600 + 5000);
  });

  it('rounds the grand total to the nearest rupee', () => {
    const v = computeItemVoucher([{ ...line, qty: 1000, listPricePaise: 4999 }], [], 'local', true);
    expect(v.totalPaise % 100).toBe(0);
  });

  it('rejects a taxable discount larger than the lines it applies to', () => {
    expect(() =>
      computeItemVoucher(
        [line],
        [{ sign: -1, affectsTaxable: true, amountPaise: 30000 }],
        'local',
        true,
      ),
    ).toThrow(/larger than the value/);
  });

  it('keeps CGST equal to SGST on an odd-paisa line', () => {
    const v = computeItemVoucher([{ ...line, qty: 1000, listPricePaise: 50 }], [], 'local', false);
    expect([v.cgstPaise, v.sgstPaise]).toEqual([5, 5]);
  });

  it('rejects empty vouchers and non-positive quantities', () => {
    expect(() => computeItemVoucher([], [], 'local', true)).toThrow(/at least one/);
    expect(() => computeItemVoucher([{ ...line, qty: 0 }], [], 'local', true)).toThrow(/quantity/);
  });

  it('total always equals taxable + tax + post-tax sundries + round-off (500 random bills)', () => {
    const lineArb = fc.record({
      qty: fc.integer({ min: 1, max: 500000 }),
      listPricePaise: fc.integer({ min: 0, max: 5000000 }),
      discBp: fc.integer({ min: 0, max: 10000 }),
      taxRateBp: fc.constantFrom(0, 500, 1200, 1800, 2800, 4000),
    });
    const sundryArb = fc.record({
      sign: fc.constantFrom(1 as const, -1 as const),
      affectsTaxable: fc.boolean(),
      amountPaise: fc.integer({ min: 0, max: 100000 }),
    });
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 1, maxLength: 8 }),
        fc.array(sundryArb, { maxLength: 4 }),
        fc.constantFrom('local' as const, 'interstate' as const, 'exempt' as const),
        fc.boolean(),
        (lines, sundries, mode, round) => {
          // a taxable sundry needs non-zero line value to spread over
          const hasValue = lines.some((l) => l.listPricePaise > 0 && l.discBp < 10000);
          fc.pre(hasValue || sundries.every((s) => !s.affectsTaxable || s.amountPaise === 0));
          let v;
          try {
            v = computeItemVoucher(lines, sundries, mode, round);
          } catch (e) {
            // only legitimate failure: spreading a sundry over all-zero lines
            expect(String(e)).toMatch(/need at least one item with a price|larger than the value/);
            return;
          }
          expect(v.totalPaise).toBe(
            v.taxablePaise + v.taxPaise + v.postTaxSundryPaise + v.roundOffPaise,
          );
          expect(v.cgstPaise + v.sgstPaise + v.igstPaise).toBe(v.taxPaise);
          expect(v.cgstPaise).toBe(v.sgstPaise);
          if (round) expect(Math.abs(v.roundOffPaise)).toBeLessThanOrEqual(50);
        },
      ),
      { numRuns: 500 },
    );
  });
});
