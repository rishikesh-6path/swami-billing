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
  const earlier = new Map<number, number>();
  if (changingVoucherId !== undefined) {
    const old = db
      .prepare(
        'SELECT item_id, price_paise FROM voucher_item WHERE voucher_id = ? ORDER BY line_no',
      )
      .all(changingVoucherId);
    for (const r of old) {
      if (!earlier.has(Number(r['item_id'])))
        earlier.set(Number(r['item_id']), Number(r['price_paise']));
    }
  }
  const limitText = `${maxBp / 100}%`;
  let atMaster = 0; // what the lines come to at the master prices
  for (const line of input.lines) {
    const item = db
      .prepare('SELECT name, sale_price_paise FROM item WHERE id = ?')
      .get(line.itemId);
    const master = earlier.get(line.itemId) ?? Number(item?.['sale_price_paise'] ?? 0);
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

/** What every customer with a credit limit owes now. Taken before a change, checked after it. */
export function limitedBalances(db: Db): Map<number, number> {
  const out = new Map<number, number>();
  const rows = db
    .prepare('SELECT id FROM account WHERE credit_limit_paise > 0 AND is_system = 0')
    .all();
  for (const r of rows) {
    out.set(Number(r['id']), accountBalance(db, Number(r['id']), '9999-12-31'));
  }
  return out;
}

/**
 * The first customer that a change has taken above their credit limit, or null. A customer who
 * was already above it is only reported when the change made it worse.
 */
export function newlyOverLimit(db: Db, before: Map<number, number>): LimitBreach | null {
  for (const [id, was] of before) {
    const account = db.prepare('SELECT name, credit_limit_paise FROM account WHERE id = ?').get(id);
    const limit = Number(account?.['credit_limit_paise'] ?? 0);
    const now = accountBalance(db, id, '9999-12-31');
    if (limit > 0 && now > limit && now > was) {
      return { accountId: id, name: String(account?.['name']), limitPaise: limit, owingPaise: now };
    }
  }
  return null;
}
