import type { Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import { esc, inr } from './invoice.ts';

/** Labels per sheet: 3 across by 8 down (24), or 4 across by 10 down (40) for small labels. */
export type LabelLayout = '3x8' | '4x10';

const GRID: Record<LabelLayout, { cols: number; rows: number }> = {
  '3x8': { cols: 3, rows: 8 },
  '4x10': { cols: 4, rows: 10 },
};

/** One sheet run may hold at most this many labels, so a typing slip cannot print a stack of paper. */
export const MAX_LABELS = 1000;

export interface LabelItem {
  name: string;
  alias: string | null;
  pricePaise: number;
  mrpPaise: number;
}

/** The items to label, looked up by id, with how many labels each. */
export function labelItems(
  db: Db,
  wanted: { itemId: number; count: number }[],
): { item: LabelItem; count: number }[] {
  const find = db.prepare('SELECT name, alias, sale_price_paise, mrp_paise FROM item WHERE id = ?');
  return wanted.map((w) => {
    const r = find.get(w.itemId);
    if (!r) throw new ValidationError('One of the items could not be found. Please pick it again.');
    return {
      item: {
        name: String(r['name']),
        alias: r['alias'] === null ? null : String(r['alias']),
        pricePaise: Number(r['sale_price_paise']),
        mrpPaise: Number(r['mrp_paise']),
      },
      count: w.count,
    };
  });
}

/**
 * A plain A4 label sheet: name, code and price on each label (and the MRP when it is set). No
 * barcodes. Long names are cut so every label keeps the same size.
 */
export function labelsHtml(
  items: { item: LabelItem; count: number }[],
  layout: LabelLayout = '3x8',
): { html: string; labels: number; pages: number } {
  const { cols, rows } = GRID[layout];
  const perPage = cols * rows;
  const all: LabelItem[] = [];
  for (const { item, count } of items) {
    if (!Number.isInteger(count) || count < 0) {
      throw new ValidationError('The number of labels must be a whole number.');
    }
    for (let i = 0; i < count; i++) all.push(item);
  }
  if (all.length === 0)
    throw new ValidationError('Please add at least one item and how many labels.');
  if (all.length > MAX_LABELS) {
    throw new ValidationError(
      `That is ${all.length} labels; at most ${MAX_LABELS} can be printed at once. Please print fewer.`,
    );
  }
  const cut = (text: string, max: number) =>
    text.length > max ? `${text.slice(0, max - 1)}…` : text;
  const nameMax = layout === '3x8' ? 48 : 34;
  const pages: string[] = [];
  for (let start = 0; start < all.length; start += perPage) {
    const cells = all.slice(start, start + perPage).map(
      (l) => `<div class="label">
  <div class="name">${esc(cut(l.name, nameMax))}</div>
  ${l.alias ? `<div class="code">Code ${esc(l.alias)}</div>` : ''}
  <div class="price">₹ ${esc(inr(l.pricePaise))}</div>
  ${l.mrpPaise > 0 ? `<div class="mrp">MRP ₹ ${esc(inr(l.mrpPaise))}</div>` : ''}
</div>`,
    );
    pages.push(`<section class="sheet">${cells.join('\n')}</section>`);
  }
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Labels</title>
<style>
  @page { size: A4; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .sheet { display: grid; grid-template-columns: repeat(${cols}, 1fr);
    grid-auto-rows: calc((297mm - 16mm) / ${rows}); page-break-after: always; }
  .sheet:last-child { page-break-after: auto; }
  .label { border: 1px dashed #999; padding: 2mm 3mm; overflow: hidden;
    display: flex; flex-direction: column; justify-content: center; }
  .name { font-weight: bold; font-size: ${layout === '3x8' ? '11pt' : '9pt'}; line-height: 1.15; }
  .code { font-size: 8pt; }
  .price { font-size: ${layout === '3x8' ? '14pt' : '11pt'}; font-weight: bold; }
  .mrp { font-size: 8pt; }
</style></head><body>
${pages.join('\n')}
</body></html>`;
  return { html, labels: all.length, pages: pages.length };
}
