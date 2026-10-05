import type { Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import { taxOn } from '../money.ts';
import { esc, inr } from './invoice.ts';

/** Labels per sheet: 3 across by 8 down (24), or 4 across by 10 down (40) for small labels. */
export type LabelLayout = '3x8' | '4x10';

/**
 * Sizes of the common A4 label sheets with no side margins: 24 labels of 70 x 37 mm and 40 labels
 * of 52.5 x 29.7 mm. The sheet is printed edge to edge; each label keeps its own inner margin, so
 * a printer that cannot print right to the edge only loses empty space.
 */
const GRID: Record<LabelLayout, { cols: number; rows: number; w: number; h: number; top: number }> =
  {
    '3x8': { cols: 3, rows: 8, w: 70, h: 37, top: 0.5 },
    '4x10': { cols: 4, rows: 10, w: 52.5, h: 29.7, top: 0 },
  };

/** One sheet run may hold at most this many labels, so a typing slip cannot print a stack of paper. */
export const MAX_LABELS = 1000;

export interface LabelItem {
  name: string;
  alias: string | null;
  /** The price the customer pays: with GST when `gstIncluded`, otherwise before GST. */
  pricePaise: number;
  /** False when the item has no GST rate yet, so the label says "+ GST". */
  gstIncluded: boolean;
  mrpPaise: number;
}

/**
 * The items to label, looked up by id, with how many labels each. The price on the label is the
 * selling price with GST at the rate in force on `asOn`, which is what the bill will charge (before
 * rounding the bill). An item with no selling price cannot be labelled.
 */
export function labelItems(
  db: Db,
  wanted: { itemId: number; count: number }[],
  asOn: string,
): { item: LabelItem; count: number }[] {
  const find = db.prepare('SELECT name, alias, sale_price_paise, mrp_paise FROM item WHERE id = ?');
  const rate = db.prepare(
    'SELECT rate_bp FROM item_tax_rate WHERE item_id = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1',
  );
  return wanted.map((w) => {
    const r = find.get(w.itemId);
    if (!r) throw new ValidationError('One of the items could not be found. Please pick it again.');
    const price = Number(r['sale_price_paise']);
    if (price <= 0) {
      throw new ValidationError(
        `${String(r['name'])} has no selling price, so its label would show 0. Please ask the owner to set the price first.`,
      );
    }
    const found = rate.get(w.itemId, asOn);
    const rateBp = found ? Number(found['rate_bp']) : null;
    return {
      item: {
        name: String(r['name']),
        alias: r['alias'] === null ? null : String(r['alias']),
        pricePaise: rateBp === null ? price : price + taxOn(price, rateBp),
        gstIncluded: rateBp !== null,
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
  const { cols, rows, w, h, top } = GRID[layout];
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
  // cut by letters (not code units), so no letter is split in half
  const cut = (text: string, max: number) => {
    const letters = Array.from(text);
    return letters.length > max ? `${letters.slice(0, max - 1).join('')}…` : text;
  };
  const nameMax = layout === '3x8' ? 48 : 34;
  const pages: string[] = [];
  for (let start = 0; start < all.length; start += perPage) {
    const cells = all.slice(start, start + perPage).map(
      (l) => `<div class="label">
  <div class="name">${esc(cut(l.name, nameMax))}</div>
  ${l.alias ? `<div class="code">Code ${esc(l.alias)}</div>` : ''}
  <div class="price">₹ ${esc(inr(l.pricePaise))} <span class="gst">${l.gstIncluded ? 'incl. GST' : '+ GST'}</span></div>
  ${l.mrpPaise > 0 ? `<div class="mrp">MRP ₹ ${esc(inr(l.mrpPaise))}</div>` : ''}
</div>`,
    );
    pages.push(`<section class="sheet">${cells.join('\n')}</section>`);
  }
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Labels</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .sheet { display: grid; grid-template-columns: repeat(${cols}, ${w}mm);
    grid-auto-rows: ${h}mm; width: 210mm; padding-top: ${top}mm;
    page-break-after: always; break-after: page; }
  .sheet:last-child { page-break-after: auto; break-after: auto; }
  .label { padding: 2.5mm 3.5mm; overflow: hidden; overflow-wrap: anywhere;
    display: flex; flex-direction: column; justify-content: center; }
  .name { font-weight: bold; font-size: ${layout === '3x8' ? '11pt' : '9pt'}; line-height: 1.15;
    max-height: 2.4em; overflow: hidden; }
  .code { font-size: 8pt; }
  .price { font-size: ${layout === '3x8' ? '14pt' : '11pt'}; font-weight: bold; }
  .gst { font-size: 7pt; font-weight: normal; }
  .mrp { font-size: 8pt; }
  /* the outline of each label shows on screen only, never on the labels */
  @media screen { .label { outline: 1px dashed #bbb; outline-offset: -1px; } }
</style></head><body>
${pages.join('\n')}
</body></html>`;
  return { html, labels: all.length, pages: pages.length };
}
