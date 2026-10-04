import { transaction, type Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import { writeAudit, type Ctx } from '../audit.ts';
import { divRound, mulDivRound, applyDiscount, lineAmount } from '../money.ts';
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
  const owingBefore = owing;
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
    // a change that does not add to what they owe is never refused, so a bill can always be corrected
    over: after > limit && after > owingBefore,
  };
}

/**
 * The reason a bill gives more discount than staff may, or null when it is fine. The discount is
 * measured against the item's price on its master record, so a lower price typed by hand counts
 * the same as a discount percentage; money taken off at the bottom of the bill (a negative bill
 * sundry) is added to it. A price above the master price is never counted as a discount.
 */
export function staffDiscountProblem(
  db: Db,
  input: ItemVoucherInput,
  maxBp: number,
  /** When a bill is being changed: its own prices count as usual, so it can be corrected after a price rise. */
  changingVoucherId?: number,
): string | null {
  if (maxBp <= 0) return null;
  // when a bill is changed, its own list prices are compared too (never its discounted prices,
  // or each change could add another discount on top)
  const earlier = new Map<number, number>();
  if (changingVoucherId !== undefined) {
    const old = db
      .prepare(
        'SELECT item_id, MAX(list_price_paise) AS price FROM voucher_item WHERE voucher_id = ? GROUP BY item_id',
      )
      .all(changingVoucherId);
    for (const r of old) earlier.set(Number(r['item_id']), Number(r['price']));
  }
  const limitText = `${maxBp / 100}%`;
  let atMaster = 0; // what the lines come to at the master prices
  for (const line of input.lines) {
    const item = db
      .prepare('SELECT name, sale_price_paise FROM item WHERE id = ?')
      .get(line.itemId);
    // the usual price, or the bill's own list price when that was higher
    const master = Math.max(Number(item?.['sale_price_paise'] ?? 0), earlier.get(line.itemId) ?? 0);
    const after = applyDiscount(line.listPricePaise, line.discBp ?? 0);
    const base = Math.max(master, after);
    atMaster += lineAmount(line.qty, base);
    if (master > 0 && after < master && divRound((master - after) * 10000, master) > maxBp) {
      return `The price of ${String(item?.['name'] ?? 'an item')} is more than ${limitText} below its usual price, which is the most discount staff may give. Please ask the owner.`;
    }
  }
  const preview = previewItemVoucher(db, input);
  const takenOff = preview.sundries.reduce(
    (t, x) => (x.signedPaise < 0 ? t - x.signedPaise : t),
    0,
  );
  const given = atMaster - preview.subtotalPaise + takenOff;
  if (given > 0 && atMaster > 0 && mulDivRound(given, 10000, atMaster) > maxBp) {
    return `The discount on this bill is more than ${limitText}, which is the most staff may give. Please ask the owner.`;
  }
  return null;
}

export interface LimitBreach {
  accountId: number;
  name: string;
  limitPaise: number;
  owingPaise: number;
}

/** Where the ledger ends now; lines written after this belong to the change being checked. */
export function journalMark(db: Db): number {
  return Number(db.prepare('SELECT COALESCE(MAX(id), 0) AS n FROM journal_line').get()?.['n']);
}

/**
 * The first customer that the ledger lines written since `mark` took above their credit limit,
 * or null. Only customers whose debt the change increased are looked at, so a change that brings
 * someone down is never reported, even while they are still above their limit.
 */
export function overLimitSince(db: Db, mark: number): LimitBreach | null {
  const touched = db
    .prepare(
      `SELECT j.account_id, SUM(j.dr_paise) - SUM(j.cr_paise) AS added, a.name, a.credit_limit_paise
       FROM journal_line j JOIN account a ON a.id = j.account_id
       WHERE j.id > ? AND a.credit_limit_paise > 0 AND a.is_system = 0
       GROUP BY j.account_id`,
    )
    .all(mark);
  for (const r of touched) {
    if (Number(r['added']) <= 0) continue;
    const id = Number(r['account_id']);
    const limit = Number(r['credit_limit_paise']);
    const now = accountBalance(db, id, '9999-12-31');
    if (now > limit) {
      return { accountId: id, name: String(r['name']), limitPaise: limit, owingPaise: now };
    }
  }
  return null;
}
