import { transaction, type Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import { parseMoney, parseQty } from '../money.ts';
import type { Ctx } from '../audit.ts';
import { createAccount } from '../masters/accounts.ts';
import {
  createItem,
  createItemGroup,
  createUnit,
  listItemGroups,
  listUnits,
} from '../masters/items.ts';

/** One parsed row and the line of the file it starts on (as a spreadsheet numbers rows). */
export interface CsvRow {
  cells: string[];
  line: number;
}

/**
 * Parses CSV (or tab-separated) text: quotes, escaped quotes, embedded newlines, BOM, CRLF.
 * A quote only opens a quoted cell at the very start of the cell, so an inch mark inside a name
 * such as 1/2" elbow is kept as text. Blank rows are skipped but still counted in line numbers.
 */
export function parseCsvLines(text: string): CsvRow[] {
  const BOM = String.fromCharCode(0xfeff);
  const input = text.startsWith(BOM) ? text.slice(1) : text;
  const firstLine = input.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows: CsvRow[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((c) => c.trim() !== '')) rows.push({ cells: row, line: rowLine });
    row = [];
  };
  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (quoted) {
      if (ch === '"' && input.charAt(i + 1) === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input.charAt(i + 1) === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else cell += ch;
  }
  endRow();
  return rows;
}

export function parseCsv(text: string): string[][] {
  return parseCsvLines(text).map((r) => r.cells);
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
  db: Db,
  text: string,
  required: string[],
  handle: (f: Fields, row: number) => void,
): ImportResult {
  const rows = parseCsvLines(text);
  const header = rows[0]?.cells;
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
  // One outer transaction for the whole file (a single disk sync instead of one per row, which
  // takes minutes for thousands of rows). Each row runs in its own savepoint, so a bad row is
  // undone and reported without touching the rest.
  transaction(db, () => {
    rows.slice(1).forEach(({ cells, line: row }) => {
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
export function importItemsCsv(db: Db, text: string, ctx: Ctx = {}): ImportResult {
  // looked up once, then kept in step as rows add groups and units; a row that fails is undone
  // completely, so only what a successful row added is remembered
  const groups = new Map(listItemGroups(db).map((g) => [g.name.toLowerCase(), g.id]));
  const units = new Map(listUnits(db).map((u) => [u.name.toLowerCase(), u.id]));
  return eachRow(db, text, ['name'], (f) => {
    const addedGroups: [string, number][] = [];
    const addedUnits: [string, number][] = [];
    transaction(db, () => {
      const groupName = f['group'] || 'General';
      const unitName = f['unit'] || 'Pcs';
      let groupId = groups.get(groupName.toLowerCase());
      if (groupId === undefined) {
        groupId = createItemGroup(db, { name: groupName }, ctx);
        addedGroups.push([groupName.toLowerCase(), groupId]);
      }
      let unitId = units.get(unitName.toLowerCase());
      if (unitId === undefined) {
        unitId = createUnit(
          db,
          {
            name: unitName,
            allowDecimals: !WHOLE_NUMBER_UNITS.has(unitName.toLowerCase()),
          },
          ctx,
        );
        addedUnits.push([unitName.toLowerCase(), unitId]);
      }
      createItem(
        db,
        {
          name: f['name'] ?? '',
          alias: f['alias'] || null,
          groupId,
          unitId,
          hsn: f['hsn'] || null,
          openingQty: f['openingQty'] ? parseQty(f['openingQty']) : 0,
          openingRatePaise: f['openingRate'] ? parseMoney(f['openingRate']) : 0,
          salePricePaise: f['price'] ? parseMoney(f['price']) : 0,
          mrpPaise: f['mrp'] ? parseMoney(f['mrp']) : 0,
          minStockQty: f['minStock'] ? parseQty(f['minStock']) : 0,
          taxRateBp: rateBp(f['gst'] ?? ''),
        },
        ctx,
      );
    });
    for (const [name, id] of addedGroups) groups.set(name, id);
    for (const [name, id] of addedUnits) units.set(name, id);
  });
}

/** Imports customers and suppliers. The Type column decides the group: "supplier" goes to creditors, anything else to debtors. */
export function importPartiesCsv(
  db: Db,
  text: string,
  defaultKind: 'customer' | 'supplier' = 'customer',
  ctx: Ctx = {},
): ImportResult {
  return eachRow(db, text, ['name'], (f) => {
    transaction(db, () => {
      const supplier = f['type']
        ? /supplier|creditor|vendor/i.test(f['type'])
        : defaultKind === 'supplier';
      const group = db
        .prepare('SELECT id FROM account_group WHERE name = ?')
        .get(supplier ? 'Sundry Creditors' : 'Sundry Debtors');
      if (!group)
        throw new ValidationError('The account groups are missing. Please contact support.');
      const drCr = f['drCr'] ?? '';
      if (drCr && !/^(dr|cr)/i.test(drCr)) {
        throw new ValidationError(
          `"${drCr}" is not Dr or Cr. Please write Dr (they owe you) or Cr (you owe them).`,
        );
      }
      const credit = /^cr/i.test(drCr);
      const creditDays = f['creditDays'] ?? '';
      if (creditDays && !/^\d{1,4}$/.test(creditDays)) {
        throw new ValidationError(`"${creditDays}" is not a valid number of credit days.`);
      }
      createAccount(
        db,
        {
          name: f['name'] ?? '',
          groupId: Number(group['id']),
          gstin: f['gstin'] || null,
          stateCode: f['state'] || null,
          phone: f['phone'] || null,
          address: f['address'] || null,
          creditDays: creditDays ? Number(creditDays) : 0,
          openingBalancePaise: f['openingBalance'] ? parseMoney(f['openingBalance']) : 0,
          // a customer normally owes us (Dr); a supplier is owed by us (Cr), unless the file says otherwise
          openingIsDr: drCr ? !credit : !supplier,
        },
        ctx,
      );
    });
  });
}

/** Example sheets people can download, edit and import. Quoted so commas in names are safe. */
export const IMPORT_SAMPLES = {
  items: [
    'Name,Alias,Group,Unit,HSN,GST %,Price,MRP,Opening stock,Opening rate,Min stock',
    'GI Clamp 1/2 inch,1500,Plumbing,Pcs,7307,18,45,50,100,30,20',
    '"Wire 1.5 sq mm, red",2201,Electrical,Roll,8544,18,1450,1600,12,1100,3',
  ].join('\n'),
  customers: [
    'Name,Phone,GSTIN,State,Address,Credit days,Opening balance,Dr/Cr',
    'Ayappan Electricals,9876543210,,33,"12 Main Road, Salem",15,2500,Dr',
  ].join('\n'),
  suppliers: [
    'Name,Phone,GSTIN,State,Address,Credit days,Opening balance,Dr/Cr',
    'Sri Murugan Traders,9812345678,27AAPFU0939F1ZV,27,"Market Street, Pune",30,15000,Cr',
  ].join('\n'),
} as const;
