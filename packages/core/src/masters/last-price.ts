import type { Db } from '../db/connection.ts';
import type { BasisPoints, Paise } from '../money.ts';

export interface LastPrice {
  listPricePaise: Paise;
  discBp: BasisPoints;
  /** The date of that bill, YYYY-MM-DD. */
  date: string;
}

/**
 * The price this customer paid last time for this item (or, for a supplier, what the shop paid
 * last time): the list price and discount on the newest posted sale (or purchase), so the counter
 * can offer the same rate again. Cancelled bills, returns and other parties are ignored.
 */
export function lastPriceFor(
  db: Db,
  args: {
    partyId: number;
    itemId: number;
    type: 'sales' | 'purchase';
    before?: string | undefined;
  },
): LastPrice | null {
  const found = db
    .prepare(
      `SELECT vi.list_price_paise, vi.disc_bp, v.date
       FROM voucher_item vi JOIN voucher v ON v.id = vi.voucher_id
       WHERE v.party_account_id = ? AND vi.item_id = ? AND v.voucher_type = ?
         AND v.status = 'posted' AND (? IS NULL OR v.date <= ?)
         AND v.party_account_id NOT IN (SELECT id FROM account WHERE name = 'Cash' AND is_system = 1)
         AND v.party_account_id NOT IN (SELECT id FROM account WHERE name = 'Cash' AND is_system = 1)
       ORDER BY v.date DESC, v.id DESC, vi.line_no DESC LIMIT 1`,
    )
    .get(args.partyId, args.itemId, args.type, args.before ?? null, args.before ?? null);
  return found
    ? {
        listPricePaise: Number(found['list_price_paise']),
        discBp: Number(found['disc_bp']),
        date: String(found['date']),
      }
    : null;
}
