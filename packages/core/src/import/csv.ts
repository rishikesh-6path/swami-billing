import { transaction, type Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import { parseMoney, parseQty } from '../money.ts';
import { createAccount } from '../masters/accounts.ts';
import {
  createItem,
  createItemGroup,
  createUnit,
  listItemGroups,
  listUnits,
} from '../masters/items.ts';

/** Parses CSV (or tab-separated) text: quotes, escaped quotes, embedded newlines, BOM, CRLF. */
export function parseCsv(text: string): string[][] {
  const BOM = String.fromCharCode(0xfeff);
  const input = text.startsWith(BOM) ? text.slice(1) : text;
  const firstLine = input.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (quoted) {
      if (ch === '"' && input.charAt(i + 1) === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input.charAt(i + 1) === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export interface ImportResult {
  created: number;
  skipped: { row: number; reason: string }[];
}

type Fields = Record<string, string>;

const SYNONYMS: Record<string, string[]> = {
  name: ['name', 'item', 'item name', 'party', 'party name', 'account', 'account name'],
  alias: ['alias', 'code', 'item code', 'short code'],
  group: ['group', 'item group', 'category'],
  unit: ['unit', 'uom'],
  hsn: ['hsn', 'hsn code', 'hsn/sac'],
  gst: ['gst', 'gst %', 'gst rate', 'tax', 'tax %', 'rate %'],
  price: ['price', 'sale price', 'selling price', 'rate'],
  mrp: ['mrp'],
  openingQty: ['opening qty', 'opening quantity', 'opening stock', 'stock', 'qty'],
  openingRate: ['opening rate', 'cost', 'purchase rate', 'cost price'],
  minStock: ['min stock', 'minimum stock', 'reorder level'],
  type: ['type', 'party type', 'kind'],
  gstin: ['gstin', 'gst no', 'gst number'],
  state: ['state', 'state code'],
  phone: ['phone', 'mobile', 'contact'],
  address: ['address'],
  creditDays: ['credit days', 'credit'],
  openingBalance: ['opening balance', 'balance', 'opening'],
  drCr: ['dr/cr', 'dr cr', 'balance type'],
};

/** Maps spreadsheet column titles (any order, many spellings) to our field names. */
function mapHeader(header: string[]): Map<number, string> {
  const map = new Map<number, string>();
  header.forEach((title, index) => {
    const t = title.trim().toLowerCase();
    for (const [field, names] of Object.entries(SYNONYMS)) {
      if (names.includes(t)) map.set(index, field);
    }
  });
  return map;
}

function eachRow(
  text: string,
  required: string[],
  handle: (f: Fields, row: number) => void,
): ImportResult {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header)
    throw new ValidationError(
      'The file is empty. Please choose a file with a heading row and your data.',
    );
  const columns = mapHeader(header);
  const present = new Set(columns.values());
  const missing = required.filter((r) => !present.has(r));
  if (missing.length > 0) {
    throw new ValidationError(
      `The file needs a "${missing[0] === 'name' ? 'Name' : missing[0]}" column in its first row.`,
    );
  }
  const result: ImportResult = { created: 0, skipped: [] };
  rows.slice(1).forEach((cells, i) => {
    const row = i + 2; // as numbered in a spreadsheet
    const fields: Fields = {};
    columns.forEach((field, index) => {
      fields[field] = (cells[index] ?? '').trim();
    });
    try {
      handle(fields, row);
      result.created += 1;
    } catch (error) {
      const reason =
        error instanceof ValidationError ||
        error instanceof SyntaxError ||
        error instanceof RangeError
          ? error.message
          : 'This row could not be read.';
      result.skipped.push({ row, reason });
    }
  });
  return result;
}

const WHOLE_NUMBER_UNITS = new Set(['pcs', 'nos', 'box', 'set', 'pair', 'roll', 'bag']);

function rateBp(text: string): number | undefined {
  if (text === '') return undefined;
  const cleaned = text.replace('%', '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned))
    throw new ValidationError(`"${text}" is not a valid GST rate.`);
  return Math.round(Number(cleaned) * 100);
}

/** Imports items from a spreadsheet. Each row is saved on its own, so one bad row never blocks the rest. */
export function importItemsCsv(db: Db, text: string): ImportResult {
  return eachRow(text, ['name'], (f) => {
    transaction(db, () => {
      const groupName = f['group'] || 'General';
      const unitName = f['unit'] || 'Pcs';
      let group = listItemGroups(db).find((g) => g.name.toLowerCase() === groupName.toLowerCase());
      if (!group)
        group = { id: createItemGroup(db, { name: groupName }), name: groupName, parentId: null };
      let unit = listUnits(db).find((u) => u.name.toLowerCase() === unitName.toLowerCase());
      if (!unit) {
        const id = createUnit(db, {
          name: unitName,
          allowDecimals: !WHOLE_NUMBER_UNITS.has(unitName.toLowerCase()),
        });
        unit = listUnits(db).find((u) => u.id === id)!;
      }
      createItem(db, {
        name: f['name'] ?? '',
        alias: f['alias'] || null,
        groupId: group.id,
        unitId: unit.id,
        hsn: f['hsn'] || null,
        openingQty: f['openingQty'] ? parseQty(f['openingQty']) : 0,
        openingRatePaise: f['openingRate'] ? parseMoney(f['openingRate']) : 0,
        salePricePaise: f['price'] ? parseMoney(f['price']) : 0,
        mrpPaise: f['mrp'] ? parseMoney(f['mrp']) : 0,
        minStockQty: f['minStock'] ? parseQty(f['minStock']) : 0,
        taxRateBp: rateBp(f['gst'] ?? ''),
      });
    });
  });
}

/** Imports customers and suppliers. The Type column decides the group: "supplier" goes to creditors, anything else to debtors. */
export function importPartiesCsv(db: Db, text: string): ImportResult {
  return eachRow(text, ['name'], (f) => {
    transaction(db, () => {
      const supplier = /supplier|creditor|vendor/i.test(f['type'] ?? '');
      const group = db
        .prepare('SELECT id FROM account_group WHERE name = ?')
        .get(supplier ? 'Sundry Creditors' : 'Sundry Debtors');
      if (!group)
        throw new ValidationError('The account groups are missing. Please contact support.');
      const credit = /^cr/i.test(f['drCr'] ?? '');
      createAccount(db, {
        name: f['name'] ?? '',
        groupId: Number(group['id']),
        gstin: f['gstin'] || null,
        stateCode: f['state'] || null,
        phone: f['phone'] || null,
        address: f['address'] || null,
        creditDays: f['creditDays'] ? Number(f['creditDays']) : 0,
        openingBalancePaise: f['openingBalance'] ? parseMoney(f['openingBalance']) : 0,
        // a customer normally owes us (Dr); a supplier is owed by us (Cr), unless the file says otherwise
        openingIsDr: f['drCr'] ? !credit : !supplier,
      });
    });
  });
}
