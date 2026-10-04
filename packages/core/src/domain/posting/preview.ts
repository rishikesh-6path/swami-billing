import type { Db } from '../../db/connection.ts';
import type { BasisPoints, Paise } from '../../money.ts';
import { computeItemVoucher, type ComputeSundry } from './compute.ts';
import { lineTaxRate } from './post.ts';
import { PostingError, isNoteType, type ItemVoucherInput } from './types.ts';

export interface PreviewProblem {
  /** 'error' means the bill cannot be saved yet; 'warning' is shown but allowed. */
  kind: 'error' | 'warning';
  message: string;
}

export interface PreviewLine {
  pricePaise: Paise;
  amountPaise: Paise;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  rateBp: BasisPoints;
}

export interface TaxTableRow {
  rateBp: BasisPoints;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
}

export interface VoucherPreview {
  /** One entry per input line; lines that are not complete yet come back as null. */
  lines: (PreviewLine | null)[];
  subtotalPaise: Paise;
  taxablePaise: Paise;
  taxPaise: Paise;
  taxTable: TaxTableRow[];
  sundries: { billSundryId: number; signedPaise: Paise }[];
  postTaxSundryPaise: Paise;
  roundOffPaise: Paise;
  totalPaise: Paise;
  problems: PreviewProblem[];
}

const EMPTY: Omit<VoucherPreview, 'lines' | 'problems'> = {
  subtotalPaise: 0,
  taxablePaise: 0,
  taxPaise: 0,
  taxTable: [],
  sundries: [],
  postTaxSundryPaise: 0,
  roundOffPaise: 0,
  totalPaise: 0,
};

/**
 * Live totals for a bill that is still being typed. Unlike posting it never throws: lines that
 * are not complete yet are skipped, and anything that would stop the bill from being saved (or
 * deserves a warning) comes back in `problems` so the screen can say so in plain words.
 */
export function previewItemVoucher(db: Db, input: ItemVoucherInput): VoucherPreview {
  const problems: PreviewProblem[] = [];
  const index: number[] = [];
  // how much of each item the whole bill takes, for the stock warning
  const neededQty = new Map<number, number>();
  for (const l of input.lines) {
    if (l.itemId > 0 && l.qty > 0) neededQty.set(l.itemId, (neededQty.get(l.itemId) ?? 0) + l.qty);
  }
  const warned = new Set<number>();
  const lines = input.lines
    .map((l, i) => ({ l, i }))
    // a note's line is a value (qty is ignored), so only the item and amount matter
    .filter(({ l }) => l.itemId > 0 && (isNoteType(input.type) || l.qty > 0))
    .map(({ l, i }) => {
      index.push(i);
      const item = db.prepare('SELECT name, hsn FROM item WHERE id = ?').get(l.itemId) as
        { name: string; hsn: string | null } | undefined;
      const name = item?.name ?? `Item ${l.itemId}`;
      const rate = input.taxMode === 'exempt' ? 0 : lineTaxRate(db, input, l);
      if (rate === undefined) {
        problems.push({
          kind: 'error',
          message:
            isNoteType(input.type) && input.refVoucherId !== undefined
              ? `"${name}" is not on the bill you are correcting.`
              : `"${name}" has no GST rate. Please set one in Items.`,
        });
      }
      const hsn = l.hsn ?? item?.hsn ?? null;
      if (
        (input.type === 'sales' || input.type === 'credit_note') &&
        !(hsn !== null && /^\d{4,8}$/.test(hsn))
      ) {
        problems.push({
          kind: 'error',
          message: `"${name}" needs an HSN code (4 to 8 digits). Please add it in Items.`,
        });
      }
      // warn once per item, for all its lines together, against the stock on the bill's date
      if (input.type === 'sales' && !warned.has(l.itemId)) {
        warned.add(l.itemId);
        const stock = db
          .prepare(
            `SELECT i.opening_qty + COALESCE((SELECT SUM(m.qty_in) - SUM(m.qty_out) FROM stock_movement m
               JOIN voucher v ON v.id = m.voucher_id
               WHERE m.item_id = i.id AND v.status = 'posted' AND m.date <= ?), 0) AS qty
             FROM item i WHERE i.id = ?`,
          )
          .get(input.date, l.itemId) as { qty: number } | undefined;
        const wanted = neededQty.get(l.itemId) ?? l.qty;
        if (stock && wanted > stock.qty) {
          problems.push({
            kind: 'warning',
            message: `Only ${stock.qty / 1000} of "${name}" is in stock.`,
          });
        }
      }
      return {
        qty: isNoteType(input.type) ? 1000 : l.qty,
        listPricePaise: l.listPricePaise,
        discBp: l.discBp ?? 0,
        taxRateBp: rate ?? 0,
      };
    });

  if (lines.length === 0) return { lines: input.lines.map(() => null), ...EMPTY, problems };

  const sundryMeta = (input.sundries ?? []).map((s) => {
    const m = db
      .prepare('SELECT sign, affects_taxable FROM bill_sundry WHERE id = ?')
      .get(s.billSundryId) as { sign: number; affects_taxable: number } | undefined;
    return {
      billSundryId: s.billSundryId,
      sundry: {
        sign: m?.sign === -1 ? -1 : 1,
        affectsTaxable: Boolean(m?.affects_taxable),
        amountPaise: s.amountPaise,
      } satisfies ComputeSundry,
    };
  });

  let computed;
  try {
    computed = computeItemVoucher(
      lines,
      sundryMeta.map((s) => s.sundry),
      input.taxMode,
      input.roundOff ?? true,
    );
  } catch (error) {
    problems.push({
      kind: 'error',
      message: error instanceof PostingError ? error.message : 'The bill could not be worked out.',
    });
    return { lines: input.lines.map(() => null), ...EMPTY, problems };
  }

  const out: (PreviewLine | null)[] = input.lines.map(() => null);
  const table = new Map<number, TaxTableRow>();
  computed.lines.forEach((c, k) => {
    const rateBp = lines[k]!.taxRateBp;
    out[index[k]!] = { ...c, rateBp };
    const row = table.get(rateBp) ?? {
      rateBp,
      taxablePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
    };
    row.taxablePaise += c.taxablePaise;
    row.cgstPaise += c.cgstPaise;
    row.sgstPaise += c.sgstPaise;
    row.igstPaise += c.igstPaise;
    table.set(rateBp, row);
  });

  if (computed.totalPaise <= 0) {
    problems.push({ kind: 'error', message: 'The bill total must be more than zero.' });
  }
  return {
    lines: out,
    subtotalPaise: computed.subtotalPaise,
    taxablePaise: computed.taxablePaise,
    taxPaise: computed.taxPaise,
    taxTable: [...table.values()].sort((a, b) => a.rateBp - b.rateBp),
    sundries: sundryMeta.map((s) => ({
      billSundryId: s.billSundryId,
      signedPaise: s.sundry.sign * s.sundry.amountPaise,
    })),
    postTaxSundryPaise: computed.postTaxSundryPaise,
    roundOffPaise: computed.roundOffPaise,
    totalPaise: computed.totalPaise,
    problems,
  };
}
