import {
  applyDiscount,
  lineAmount,
  roundOffToRupee,
  halfTaxOn,
  taxOn,
  type BasisPoints,
  type Milli,
  type Paise,
} from '../../money.ts';
import { PostingError, type TaxMode } from './types.ts';

export interface ComputeLine {
  qty: Milli;
  listPricePaise: Paise;
  discBp: BasisPoints;
  taxRateBp: BasisPoints;
}

export interface ComputeSundry {
  /** +1 adds to the invoice, -1 subtracts. */
  sign: 1 | -1;
  /** When true the sundry changes the taxable value (spread across lines before tax). */
  affectsTaxable: boolean;
  amountPaise: Paise;
}

export interface ComputedLine {
  pricePaise: Paise;
  amountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
}

export interface ComputedVoucher {
  lines: ComputedLine[];
  subtotalPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  taxPaise: Paise;
  /** Sum of signed sundries that do not affect taxable value (added after tax). */
  postTaxSundryPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
}

/**
 * Splits `total` across `weights` in proportion, using largest-remainder so the parts always
 * sum exactly to `total`. Works for negative totals (sign is applied afterwards).
 */
export function allocate(total: Paise, weights: Paise[]): Paise[] {
  if (total === 0) return weights.map(() => 0);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0)
    throw new PostingError(
      'Extra charges or discounts need at least one item with a price. Please enter the item prices first.',
    );
  const sign = total < 0 ? -1 : 1;
  const t = BigInt(Math.abs(total));
  const sum = BigInt(weightSum);
  const parts = weights.map((w) => {
    const product = t * BigInt(w);
    return { base: product / sum, rem: product % sum };
  });
  let leftover = Number(t - parts.reduce((a, p) => a + p.base, 0n));
  const order = parts
    .map((p, index) => ({ index, rem: p.rem }))
    .sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  const result = parts.map((p) => Number(p.base));
  for (const { index } of order) {
    if (leftover === 0) break;
    result[index] = (result[index] ?? 0) + 1;
    leftover -= 1;
  }
  return result.map((r) => (r === 0 ? 0 : sign * r));
}

/**
 * Pure computation of an item voucher's amounts. Rules (KICKOFF section 6):
 * - tax per line in paise, half away from zero;
 * - bill sundries that affect taxable value are spread proportionally over lines before tax;
 * - other sundries are added after tax;
 * - optional round-off of the grand total to the nearest rupee.
 */
export function computeItemVoucher(
  lines: ComputeLine[],
  sundries: ComputeSundry[],
  taxMode: TaxMode,
  roundOff: boolean,
): ComputedVoucher {
  if (lines.length === 0) throw new PostingError('Please add at least one item.');

  const priced = lines.map((line) => {
    if (line.qty <= 0) throw new PostingError('Item quantity must be greater than zero');
    const pricePaise = applyDiscount(line.listPricePaise, line.discBp);
    return { pricePaise, amountPaise: lineAmount(line.qty, pricePaise) };
  });

  const affecting = sundries
    .filter((s) => s.affectsTaxable)
    .reduce((sum, s) => sum + s.sign * s.amountPaise, 0);
  const postTaxSundryPaise = sundries
    .filter((s) => !s.affectsTaxable)
    .reduce((sum, s) => sum + s.sign * s.amountPaise, 0);
  const shares = allocate(
    affecting,
    priced.map((p) => p.amountPaise),
  );

  const computed = lines.map((line, i): ComputedLine => {
    const p = priced[i]!;
    const taxablePaise = p.amountPaise + (shares[i] ?? 0);
    if (taxablePaise < 0) {
      throw new PostingError('A discount is larger than the value of the lines it applies to');
    }
    if (taxMode === 'exempt') {
      return { ...p, taxablePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 };
    }
    if (taxMode === 'local') {
      const half = halfTaxOn(taxablePaise, line.taxRateBp);
      return { ...p, taxablePaise, cgstPaise: half, sgstPaise: half, igstPaise: 0 };
    }
    return {
      ...p,
      taxablePaise,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: taxOn(taxablePaise, line.taxRateBp),
    };
  });

  const sum = (pick: (l: ComputedLine) => number) => computed.reduce((a, l) => a + pick(l), 0);
  const subtotalPaise = sum((l) => l.amountPaise);
  const taxablePaise = sum((l) => l.taxablePaise);
  const cgstPaise = sum((l) => l.cgstPaise);
  const sgstPaise = sum((l) => l.sgstPaise);
  const igstPaise = sum((l) => l.igstPaise);
  const taxPaise = cgstPaise + sgstPaise + igstPaise;
  const beforeRound = taxablePaise + taxPaise + postTaxSundryPaise;
  const roundOffPaise = roundOff ? roundOffToRupee(beforeRound) : 0;

  return {
    lines: computed,
    subtotalPaise,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    taxPaise,
    postTaxSundryPaise,
    roundOffPaise,
    totalPaise: beforeRound + roundOffPaise,
  };
}
