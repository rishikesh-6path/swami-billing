import { writeAudit, type Ctx } from '../audit.ts';
import { transaction, type Db } from '../db/connection.ts';
import { getSetting, setSetting } from '../settings.ts';
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
  offset: LabelOffset = NO_OFFSET,
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
  const html = sheetPage(pages, layout, offset);
  return { html, labels: all.length, pages: pages.length };
}

/** Moves the whole print on the sheet, in tenths of a millimetre (down and right are positive). */
export interface LabelOffset {
  topTenthMm: number;
  leftTenthMm: number;
}

export const NO_OFFSET: LabelOffset = { topTenthMm: 0, leftTenthMm: 0 };
/** The furthest the print can be moved: 5 mm either way. */
export const MAX_OFFSET_TENTH_MM = 50;

function sheetPage(pages: string[], layout: LabelLayout, offset: LabelOffset): string {
  const { cols, w, h, top } = GRID[layout];
  const mm = (tenths: number) => `${(tenths / 10).toFixed(1)}mm`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Labels</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .sheet { display: grid; grid-template-columns: repeat(${cols}, ${w}mm);
    grid-auto-rows: ${h}mm; width: 210mm; padding-top: ${top}mm;
    position: relative; top: ${mm(offset.topTenthMm)}; left: ${mm(offset.leftTenthMm)};
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
  .test { outline: 0.3mm solid #000; outline-offset: -0.15mm; align-items: center; font-size: 16pt; }
  /* the outline of each label shows on screen only, never on the labels */
  @media screen { .label { outline: 1px dashed #bbb; outline-offset: -1px; } }
</style></head><body>
${pages.join('\n')}
</body></html>`;
}

/** Checks an offset typed by the owner. */
export function checkLabelOffset(offset: LabelOffset): LabelOffset {
  for (const v of [offset.topTenthMm, offset.leftTenthMm]) {
    if (!Number.isInteger(v) || Math.abs(v) > MAX_OFFSET_TENTH_MM) {
      throw new ValidationError('The print can be moved by at most 5 mm each way.');
    }
  }
  return offset;
}

/**
 * A test sheet: every label drawn as a box with its number, so the owner can hold the print
 * against a sheet of labels and see how far, and which way, to move it.
 */
export function calibrationHtml(layout: LabelLayout, offset: LabelOffset): string {
  checkLabelOffset(offset);
  const { cols, rows } = GRID[layout];
  const cells = Array.from(
    { length: cols * rows },
    (_, i) => `<div class="label test">${i + 1}</div>`,
  ).join('\n');
  return sheetPage([`<section class="sheet">${cells}</section>`], layout, offset);
}

const LAYOUT_KEY = 'labels.layout';
const OFFSET_KEY = 'labels.offset';

/** The label sheet and position the owner chose (the usual 24-label sheet, not moved, until then). */
export function getLabelSettings(db: Db): { layout: LabelLayout } & LabelOffset {
  const layout = getSetting(db, LAYOUT_KEY) === '4x10' ? '4x10' : '3x8';
  const [top, left] = (getSetting(db, OFFSET_KEY) ?? '0,0').split(',').map(Number);
  const safe = (n: number | undefined) =>
    Number.isInteger(n) && Math.abs(n!) <= MAX_OFFSET_TENTH_MM ? n! : 0;
  return { layout, topTenthMm: safe(top), leftTenthMm: safe(left) };
}

export function saveLabelSettings(
  db: Db,
  settings: { layout: LabelLayout } & LabelOffset,
  ctx: Ctx = {},
): void {
  checkLabelOffset(settings);
  transaction(db, () => {
    const before = getLabelSettings(db);
    setSetting(db, LAYOUT_KEY, settings.layout);
    setSetting(db, OFFSET_KEY, `${settings.topTenthMm},${settings.leftTenthMm}`);
    writeAudit(db, ctx, {
      action: 'label_settings_changed',
      table: 'setting',
      rowId: 0,
      before,
      after: settings,
    });
  });
}
