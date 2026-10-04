import { transaction, type Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import { writeAudit, type Ctx } from '../audit.ts';
import { accountBalance } from '../reports/ledger.ts';
import { getSetting, setSetting } from '../settings.ts';
import { previewItemVoucher } from './posting/preview.ts';
import type { ItemVoucherInput } from './posting/types.ts';

const MAX_DISCOUNT_KEY = 'discount.staff_max_bp';

/** The biggest discount (in basis points, 1% = 100) staff may give; 0 means staff have no limit. */
export function getStaffMaxDiscountBp(db: Db): number {
  const n = Number(getSetting(db, MAX_DISCOUNT_KEY) ?? '0');
  return Number.isInteger(n) && n > 0 && n <= 10000 ? n : 0;
}

export function setStaffMaxDiscountBp(db: Db, bp: number, ctx: Ctx = {}): void {
  if (!Number.isInteger(bp) || bp < 0 || bp > 10000) {
    throw new ValidationError('The discount limit must be between 0 and 100 per cent.');
  }
  transaction(db, () => {
    const before = getStaffMaxDiscountBp(db);
    setSetting(db, MAX_DISCOUNT_KEY, String(bp));
    writeAudit(db, ctx, {
      action: 'discount_limit_changed',
      table: 'setting',
      rowId: 0,
      before: { bp: before },
      after: { bp },
    });
  });
}

export interface CreditCheck {
  limitPaise: number;
  /** What the customer owes now, not counting the bill being changed. */
  owingPaise: number;
  /** What they would owe after this bill. */
  afterPaise: number;
  /** True when this bill adds to what they owe and takes them above the limit. */
  over: boolean;
}

/**
 * Compares what a customer would owe after a bill with the limit on their page. `billPaise` is the
 * part of the bill that is left unpaid (total minus money received now). Returns null when the
 * customer has no limit, so the screens have nothing to say.
 */
export function creditCheck(
  db: Db,
  args: { partyId: number; billPaise: number; excludeVoucherId?: number | undefined },
): CreditCheck | null {
  const account = db
    .prepare('SELECT credit_limit_paise, is_system FROM account WHERE id = ?')
    .get(args.partyId);
  const limit = Number(account?.['credit_limit_paise'] ?? 0);
  if (!account || limit <= 0 || account['is_system']) return null;
  let owing = accountBalance(db, args.partyId, '9999-12-31');
  if (args.excludeVoucherId !== undefined) {
    const old = db
      .prepare(
        `SELECT COALESCE(SUM(j.dr_paise), 0) - COALESCE(SUM(j.cr_paise), 0) AS net
         FROM journal_line j JOIN voucher v ON v.id = j.voucher_id
         WHERE j.voucher_id = ? AND j.account_id = ? AND v.status = 'posted'`,
      )
      .get(args.excludeVoucherId, args.partyId);
    owing -= Number(old?.['net'] ?? 0);
  }
  const after = owing + args.billPaise;
  return {
    limitPaise: limit,
    owingPaise: owing,
    afterPaise: after,
    over: args.billPaise > 0 && after > limit,
  };
}

/**
 * The reason a bill gives more discount than staff may, or null when it is fine. Line discounts
 * are compared one by one; money taken off at the bottom (a negative bill sundry) is compared with
 * the value of all the lines.
 */
export function staffDiscountProblem(
  db: Db,
  input: ItemVoucherInput,
  maxBp: number,
): string | null {
  if (maxBp <= 0) return null;
  const limitText = `${maxBp / 100}%`;
  for (const line of input.lines) {
    if ((line.discBp ?? 0) > maxBp) {
      const item = db.prepare('SELECT name FROM item WHERE id = ?').get(line.itemId);
      return `The discount on ${String(item?.['name'] ?? 'an item')} is more than ${limitText}, which is the most staff may give. Please ask the owner.`;
    }
  }
  const preview = previewItemVoucher(db, input);
  const takenOff = preview.sundries.reduce(
    (t, s) => (s.signedPaise < 0 ? t - s.signedPaise : t),
    0,
  );
  if (takenOff > 0 && takenOff * 10000 > maxBp * preview.subtotalPaise) {
    return `The money taken off this bill is more than ${limitText}, which is the most staff may give. Please ask the owner.`;
  }
  return null;
}
