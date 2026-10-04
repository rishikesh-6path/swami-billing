import { transaction, type Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import { divRound, mulDivRound } from '../money.ts';
import { writeAudit, type Ctx } from '../audit.ts';

/** How the new prices are rounded: to the paisa, to the nearest rupee, or to the nearest 50 paise. */
export type PriceRounding = 'exact' | 'rupee' | 'fifty';

const STEP: Record<PriceRounding, number> = { exact: 1, rupee: 100, fifty: 50 };

export interface PriceChangeArgs {
  /** Only items in this group (and the groups inside it); every item when left out. */
  groupId?: number | undefined;
  /** 1000 = 10% dearer, -500 = 5% cheaper. */
  percentBp: number;
  /** Change the printed (MRP) price as well as the selling price. */
  alsoMrp?: boolean | undefined;
  rounding?: PriceRounding | undefined;
}

export interface PriceChangeRow {
  itemId: number;
  name: string;
  alias: string | null;
  groupName: string;
  oldSalePaise: number;
  newSalePaise: number;
  oldMrpPaise: number;
  newMrpPaise: number;
}

function newPrice(old: number, percentBp: number, rounding: PriceRounding): number {
  if (old <= 0) return old;
  const step = STEP[rounding];
  const exact = mulDivRound(old, 10000 + percentBp, 10000);
  return Math.max(step, divRound(exact, step) * step);
}

function check(args: PriceChangeArgs): PriceRounding {
  if (!Number.isInteger(args.percentBp) || args.percentBp === 0) {
    throw new ValidationError('Please type how many per cent to add or take off.');
  }
  if (args.percentBp < -9000 || args.percentBp > 100000) {
    throw new ValidationError('The change must be between 90% cheaper and 1000% dearer.');
  }
  return args.rounding ?? 'rupee';
}

/** What every price would become. Only items whose price actually changes are listed. */
export function previewPriceChange(db: Db, args: PriceChangeArgs): PriceChangeRow[] {
  const rounding = check(args);
  const rows = db
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM item_group WHERE id = ?
         UNION ALL SELECT g.id FROM item_group g JOIN tree t ON g.parent_id = t.id)
       SELECT i.id, i.name, i.alias, g.name AS group_name, i.sale_price_paise, i.mrp_paise
       FROM item i JOIN item_group g ON g.id = i.group_id
       WHERE i.is_active = 1 AND (? IS NULL OR i.group_id IN (SELECT id FROM tree))
       ORDER BY g.name, i.name`,
    )
    .all(args.groupId ?? 0, args.groupId ?? null);
  const out: PriceChangeRow[] = [];
  for (const r of rows) {
    const oldSale = Number(r['sale_price_paise']);
    const oldMrp = Number(r['mrp_paise']);
    const newSale = newPrice(oldSale, args.percentBp, rounding);
    const newMrp = args.alsoMrp ? newPrice(oldMrp, args.percentBp, rounding) : oldMrp;
    if (newSale === oldSale && newMrp === oldMrp) continue;
    out.push({
      itemId: Number(r['id']),
      name: String(r['name']),
      alias: r['alias'] === null ? null : String(r['alias']),
      groupName: String(r['group_name']),
      oldSalePaise: oldSale,
      newSalePaise: newSale,
      oldMrpPaise: oldMrp,
      newMrpPaise: newMrp,
    });
  }
  return out;
}

/**
 * Changes the selling prices of the chosen items in one step, with one audit row per item. Bills
 * already made keep the price they were made at; only new bills see the new prices.
 */
export function applyPriceChange(
  db: Db,
  args: PriceChangeArgs,
  ctx: Ctx = {},
): { changed: number } {
  const rows = previewPriceChange(db, args);
  if (rows.length === 0) throw new ValidationError('No price would change.');
  transaction(db, () => {
    const update = db.prepare('UPDATE item SET sale_price_paise = ?, mrp_paise = ? WHERE id = ?');
    for (const r of rows) {
      update.run(r.newSalePaise, r.newMrpPaise, r.itemId);
      writeAudit(db, ctx, {
        action: 'price_change',
        table: 'item',
        rowId: r.itemId,
        before: { salePricePaise: r.oldSalePaise, mrpPaise: r.oldMrpPaise },
        after: { salePricePaise: r.newSalePaise, mrpPaise: r.newMrpPaise },
      });
    }
  });
  return { changed: rows.length };
}
