import { transaction, type Db } from '../../db/connection.ts';
import { assertDateOpen } from '../../books/control.ts';
import { getCompanyStateCode } from '../../settings.ts';
import { computeItemVoucher, type ComputedVoucher } from './compute.ts';
import {
  PostingError,
  UnbalancedVoucherError,
  type EntryVoucherInput,
  type ItemVoucherInput,
  type ItemVoucherType,
  type PostedVoucher,
  type PostOptions,
  type StockVoucherInput,
  isItemInput,
  isStockInput,
  type VoucherInput,
} from './types.ts';

/*
 * Posting rules (D = debit, C = credit). "Party" is the customer/supplier account.
 *
 *   type             party  goods acct   tax accts   stock
 *   sales            D      Sales C      Output C    out
 *   sales_return     C      Sales D      Output D    in
 *   purchase         C      Purchase D   Input D     in
 *   purchase_return  D      Purchase C   Input C     out
 *
 * Bill sundries post to their own account on the goods side when they add to the invoice
 * (sign +1) and on the opposite side when they subtract. Round-off follows the same rule.
 * A settlement (cash/UPI received or paid on the spot) debits/credits the settlement account
 * on the party's side and takes the opposite side against the party.
 * Entry vouchers (receipt, payment, journal, contra, debit/credit note) post their entries as given.
 */
interface Rule {
  partySide: 'dr' | 'cr';
  goodsAccount: 'Sales' | 'Purchase';
  taxPrefix: 'Output' | 'Input';
  stock: 'in' | 'out';
}

const RULES: Record<ItemVoucherType, Rule> = {
  sales: { partySide: 'dr', goodsAccount: 'Sales', taxPrefix: 'Output', stock: 'out' },
  sales_return: { partySide: 'cr', goodsAccount: 'Sales', taxPrefix: 'Output', stock: 'in' },
  purchase: { partySide: 'cr', goodsAccount: 'Purchase', taxPrefix: 'Input', stock: 'in' },
  purchase_return: { partySide: 'dr', goodsAccount: 'Purchase', taxPrefix: 'Input', stock: 'out' },
};

type Side = 'dr' | 'cr';
const opposite = (side: Side): Side => (side === 'dr' ? 'cr' : 'dr');

interface JournalDraft {
  accountId: number;
  side: Side;
  amountPaise: number;
}

function row(db: Db, sql: string, ...params: (string | number)[]) {
  return db.prepare(sql).get(...params);
}

function systemAccountId(db: Db, name: string): number {
  const found = row(db, 'SELECT id FROM account WHERE name = ? AND is_system = 1', name);
  if (!found) throw new PostingError(`System account "${name}" is missing`);
  return Number(found['id']);
}

function assertRealDate(date: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const valid =
    match !== null &&
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
      .toISOString()
      .slice(0, 10) === date;
  if (!valid) throw new PostingError(`Invalid date "${date}"`);
}

export function financialYearFor(db: Db, date: string): number {
  assertRealDate(date);
  const fy = row(
    db,
    'SELECT id, is_locked FROM financial_year WHERE start_date <= ? AND end_date >= ?',
    date,
    date,
  );
  if (!fy) throw new PostingError(`No financial year covers ${date}`);
  if (fy['is_locked']) throw new PostingError(`The financial year for ${date} is locked`);
  return Number(fy['id']);
}

const REFERENCED_TYPE: Partial<Record<string, string>> = {
  sales_return: 'sales',
  credit_note: 'sales',
  purchase_return: 'purchase',
  debit_note: 'purchase',
};

/** Credit/debit notes must reference the original invoice (KICKOFF section 8). */
function assertReference(db: Db, input: VoucherInput, legacyImport: boolean): void {
  const expected = REFERENCED_TYPE[input.type];
  if (!expected) return;
  if (input.refVoucherId === undefined) {
    if (legacyImport) return;
    throw new PostingError(`A ${input.type.replace('_', ' ')} must reference the original invoice`);
  }
  const ref = row(
    db,
    'SELECT voucher_type, status, date FROM voucher WHERE id = ?',
    input.refVoucherId,
  );
  if (!ref) throw new PostingError(`Referenced voucher ${input.refVoucherId} does not exist`);
  if (ref['voucher_type'] !== expected || ref['status'] !== 'posted') {
    throw new PostingError(
      `A ${input.type.replace('_', ' ')} must reference a posted ${expected} voucher`,
    );
  }
  if (String(ref['date']) > input.date) {
    throw new PostingError('A return or note cannot be dated before the invoice it refers to');
  }
}

/** Next gap-free number for (type, series, fy). Must be called inside the insert transaction. */
function nextNumber(db: Db, type: string, seriesId: number, fyId: number): number {
  const series = row(db, 'SELECT voucher_type FROM voucher_series WHERE id = ?', seriesId);
  if (!series) throw new PostingError(`Voucher series ${seriesId} does not exist`);
  if (series['voucher_type'] !== type) {
    throw new PostingError(
      `Series ${seriesId} is for ${String(series['voucher_type'])}, not ${type}`,
    );
  }
  db.prepare(
    'INSERT OR IGNORE INTO voucher_counter (voucher_type, series_id, fy_id, last_no) VALUES (?, ?, ?, 0)',
  ).run(type, seriesId, fyId);
  db.prepare(
    'UPDATE voucher_counter SET last_no = last_no + 1 WHERE voucher_type = ? AND series_id = ? AND fy_id = ?',
  ).run(type, seriesId, fyId);
  const counter = row(
    db,
    'SELECT last_no FROM voucher_counter WHERE voucher_type = ? AND series_id = ? AND fy_id = ?',
    type,
    seriesId,
    fyId,
  );
  return Number(counter?.['last_no']);
}

export function resolveTaxRate(db: Db, itemId: number, date: string): number | undefined {
  const rate = row(
    db,
    'SELECT rate_bp FROM item_tax_rate WHERE item_id = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1',
    itemId,
    date,
  );
  return rate ? Number(rate['rate_bp']) : undefined;
}

interface Header {
  type: string;
  seriesId: number;
  date: string;
  fyId: number;
  number: number;
  partyAccountId: number | null;
  saleTypeId: number | null;
  input: VoucherInput;
  computed?: ComputedVoucher | undefined;
  totalPaise: number;
  posStateCode?: string | null | undefined;
  partyGstin?: string | null | undefined;
}

function insertHeader(db: Db, h: Header, now: string): number {
  const c = h.computed;
  const result = db
    .prepare(
      `INSERT INTO voucher (voucher_type, series_id, number, date, fy_id, party_account_id, sale_type_id,
         broker, narration, status, subtotal_paise, taxable_paise, tax_paise, round_off_paise, total_paise,
         ref_voucher_id, created_by, created_at, modified_at, legacy_ref, pos_state_code, party_gstin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      h.type,
      h.seriesId,
      h.number,
      h.date,
      h.fyId,
      h.partyAccountId,
      h.saleTypeId,
      h.input.broker ?? null,
      h.input.narration ?? null,
      c?.subtotalPaise ?? 0,
      c?.taxablePaise ?? 0,
      c?.taxPaise ?? 0,
      c?.roundOffPaise ?? 0,
      h.totalPaise,
      h.input.refVoucherId ?? null,
      h.input.createdBy ?? null,
      now,
      now,
      h.input.legacyRef ?? null,
      h.posStateCode ?? null,
      h.partyGstin ?? null,
    );
  return Number(result.lastInsertRowid);
}

function writeJournal(db: Db, voucherId: number, drafts: JournalDraft[]): void {
  const insert = db.prepare(
    'INSERT INTO journal_line (voucher_id, account_id, dr_paise, cr_paise, line_no) VALUES (?, ?, ?, ?, ?)',
  );
  let lineNo = 0;
  for (const d of drafts) {
    if (d.amountPaise === 0) continue;
    if (d.amountPaise < 0) throw new PostingError('Journal amounts must be positive');
    lineNo += 1;
    insert.run(
      voucherId,
      d.accountId,
      d.side === 'dr' ? d.amountPaise : 0,
      d.side === 'cr' ? d.amountPaise : 0,
      lineNo,
    );
  }
}

/** Invariant 1, checked from the database itself so the transaction rolls back if violated. */
function assertBalanced(db: Db, voucherId: number): void {
  const sums = row(
    db,
    'SELECT COALESCE(SUM(dr_paise), 0) AS dr, COALESCE(SUM(cr_paise), 0) AS cr FROM journal_line WHERE voucher_id = ?',
    voucherId,
  );
  const dr = Number(sums?.['dr']);
  const cr = Number(sums?.['cr']);
  if (dr !== cr || dr <= 0) throw new UnbalancedVoucherError(dr, cr);
}

function audit(
  db: Db,
  now: string,
  userId: number | undefined,
  action: string,
  voucherId: number,
): void {
  const after = row(db, 'SELECT * FROM voucher WHERE id = ?', voucherId);
  db.prepare(
    'INSERT INTO audit_log (at, user_id, action, table_name, row_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, NULL, ?)',
  ).run(now, userId ?? null, action, 'voucher', voucherId, JSON.stringify(after));
}

function buildItemVoucher(db: Db, input: ItemVoucherInput, legacyImport: boolean) {
  const rule = RULES[input.type];

  // Place of supply and the party's GSTIN are frozen on the voucher (see migration 0004).
  const home = getCompanyStateCode(db);
  const party = row(db, 'SELECT gstin, state_code FROM account WHERE id = ?', input.partyAccountId);
  if (!party) throw new PostingError(`Party account ${input.partyAccountId} does not exist`);
  const partyState = party['state_code'] === null ? null : String(party['state_code']);
  let posStateCode = home;
  if (input.taxMode === 'interstate') {
    if (!partyState) {
      throw new PostingError("Please add the customer's state before making an interstate bill.");
    }
    if (partyState === home) {
      throw new PostingError(
        'This customer is in your own state, so the bill cannot be interstate.',
      );
    }
    posStateCode = partyState;
  } else if (input.taxMode === 'exempt') {
    posStateCode = partyState ?? home;
  }
  const partyGstin = party['gstin'] === null ? null : String(party['gstin']);
  if (input.saleTypeId !== undefined) {
    const saleType = row(db, 'SELECT tax_mode FROM sale_type WHERE id = ?', input.saleTypeId);
    if (!saleType) throw new PostingError(`Sale type ${input.saleTypeId} does not exist`);
    if (saleType['tax_mode'] !== input.taxMode) {
      throw new PostingError(
        `Sale type is ${String(saleType['tax_mode'])} but tax mode ${input.taxMode} was given`,
      );
    }
  }
  const sundryRows = (input.sundries ?? []).map((s) => {
    const m = row(
      db,
      'SELECT sign, affects_taxable, account_id FROM bill_sundry WHERE id = ?',
      s.billSundryId,
    );
    if (!m) throw new PostingError(`Bill sundry ${s.billSundryId} does not exist`);
    if (s.amountPaise < 0) throw new PostingError('Bill sundry amounts must be positive');
    return {
      sign: Number(m['sign']) as 1 | -1,
      affectsTaxable: Boolean(m['affects_taxable']),
      amountPaise: s.amountPaise,
      accountId: Number(m['account_id']),
    };
  });

  const lines = input.lines.map((l) => {
    const rate = l.taxRateBp ?? resolveTaxRate(db, l.itemId, input.date);
    if (rate === undefined && input.taxMode !== 'exempt') {
      throw new PostingError(`Item ${l.itemId} has no tax rate effective on ${input.date}`);
    }
    const item = row(db, 'SELECT hsn, unit_id FROM item WHERE id = ?', l.itemId);
    if (!item) throw new PostingError(`Item ${l.itemId} does not exist`);
    if (Number(item['unit_id']) !== l.unitId) {
      throw new PostingError(`Item ${l.itemId} is stocked in a different unit than the line uses`);
    }
    const unit = row(db, 'SELECT decimals FROM unit WHERE id = ?', l.unitId);
    if (Number(unit?.['decimals']) === 0 && l.qty % 1000 !== 0) {
      throw new PostingError(
        `Item ${l.itemId} is sold in whole units; quantity must not have decimals`,
      );
    }
    const hsn = l.hsn ?? (item['hsn'] === null ? null : String(item['hsn']));
    if (input.type === 'sales' && !legacyImport && !(hsn !== null && /^\d{4,8}$/.test(hsn))) {
      throw new PostingError(`Item ${l.itemId} needs an HSN code of at least 4 digits to be sold`);
    }
    return {
      ...l,
      discBp: l.discBp ?? 0,
      // an exempt sale charges no tax, so no rate is frozen on the line
      taxRateBp: input.taxMode === 'exempt' ? 0 : (rate ?? 0),
      hsn,
    };
  });

  const computed = computeItemVoucher(lines, sundryRows, input.taxMode, input.roundOff ?? true);
  if (computed.totalPaise <= 0) throw new PostingError('Voucher total must be greater than zero');

  const settlements = input.settlements ?? [];
  const settled = settlements.reduce((a, s) => a + s.amountPaise, 0);
  if (settlements.some((s) => s.amountPaise <= 0))
    throw new PostingError('Settlement amounts must be positive');
  if (settled > computed.totalPaise) throw new PostingError('Settlements exceed the voucher total');

  const goodsSide: Side = opposite(rule.partySide);
  const drafts: JournalDraft[] = [
    { accountId: input.partyAccountId, side: rule.partySide, amountPaise: computed.totalPaise },
    {
      accountId: systemAccountId(db, rule.goodsAccount),
      side: goodsSide,
      amountPaise: computed.subtotalPaise,
    },
  ];
  for (const s of sundryRows) {
    drafts.push({
      accountId: s.accountId,
      side: s.sign === 1 ? goodsSide : opposite(goodsSide),
      amountPaise: s.amountPaise,
    });
  }
  const taxAccounts: [string, number][] = [
    [`${rule.taxPrefix} CGST`, computed.cgstPaise],
    [`${rule.taxPrefix} SGST`, computed.sgstPaise],
    [`${rule.taxPrefix} IGST`, computed.igstPaise],
  ];
  for (const [name, amount] of taxAccounts) {
    drafts.push({ accountId: systemAccountId(db, name), side: goodsSide, amountPaise: amount });
  }
  if (computed.roundOffPaise !== 0) {
    drafts.push({
      accountId: systemAccountId(db, 'Round Off'),
      side: computed.roundOffPaise > 0 ? goodsSide : opposite(goodsSide),
      amountPaise: Math.abs(computed.roundOffPaise),
    });
  }
  for (const s of settlements) {
    drafts.push({ accountId: s.accountId, side: rule.partySide, amountPaise: s.amountPaise });
    drafts.push({
      accountId: input.partyAccountId,
      side: opposite(rule.partySide),
      amountPaise: s.amountPaise,
    });
  }
  return { computed, lines, sundryRows, drafts, settlements, posStateCode, partyGstin };
}

/**
 * Posts a voucher: header, lines, journal, stock and audit row in one transaction. Any
 * failure, including an unbalanced journal, rolls everything back.
 */
export function postVoucher(db: Db, input: VoucherInput, opts: PostOptions = {}): PostedVoucher {
  const now = opts.now ?? new Date().toISOString();
  const legacyImport = opts.legacyImport ?? false;
  return transaction(db, () => {
    assertDateOpen(db, input.date, opts.role);
    const fyId = financialYearFor(db, input.date);
    assertReference(db, input, legacyImport);
    const number = nextNumber(db, input.type, input.seriesId, fyId);

    if (isStockInput(input)) return postStockVoucher(db, input, fyId, number, now);

    if (isItemInput(input)) {
      assertReturnQuantities(db, input, legacyImport);
      const built = buildItemVoucher(db, input, legacyImport);
      const voucherId = insertHeader(
        db,
        {
          type: input.type,
          seriesId: input.seriesId,
          date: input.date,
          fyId,
          number,
          partyAccountId: input.partyAccountId,
          posStateCode: built.posStateCode,
          partyGstin: built.partyGstin,
          saleTypeId: input.saleTypeId ?? null,
          input,
          computed: built.computed,
          totalPaise: built.computed.totalPaise,
        },
        now,
      );
      const insertLine = db.prepare(
        `INSERT INTO voucher_item (voucher_id, line_no, item_id, qty, unit_id, list_price_paise, disc_bp, price_paise,
           amount_paise, hsn, tax_rate_bp, taxable_paise, cgst_paise, sgst_paise, igst_paise)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertStock = db.prepare(
        'INSERT INTO stock_movement (voucher_id, item_id, qty_in, qty_out, rate_paise, date) VALUES (?, ?, ?, ?, ?, ?)',
      );
      const stockIn = RULES[input.type].stock === 'in';
      built.lines.forEach((l, i) => {
        const c = built.computed.lines[i]!;
        insertLine.run(
          voucherId,
          i + 1,
          l.itemId,
          l.qty,
          l.unitId,
          l.listPricePaise,
          l.discBp,
          c.pricePaise,
          c.amountPaise,
          l.hsn,
          l.taxRateBp,
          c.taxablePaise,
          c.cgstPaise,
          c.sgstPaise,
          c.igstPaise,
        );
        insertStock.run(
          voucherId,
          l.itemId,
          stockIn ? l.qty : 0,
          stockIn ? 0 : l.qty,
          c.pricePaise,
          input.date,
        );
      });
      const insertSundry = db.prepare(
        'INSERT INTO voucher_sundry (voucher_id, bill_sundry_id, amount_paise) VALUES (?, ?, ?)',
      );
      for (const s of input.sundries ?? [])
        insertSundry.run(voucherId, s.billSundryId, s.amountPaise);
      const insertSettlement = db.prepare(
        'INSERT INTO voucher_settlement (voucher_id, account_id, amount_paise) VALUES (?, ?, ?)',
      );
      for (const s of built.settlements)
        insertSettlement.run(voucherId, s.accountId, s.amountPaise);

      writeJournal(db, voucherId, built.drafts);
      assertBalanced(db, voucherId);
      audit(db, now, input.createdBy, 'create', voucherId);
      return { voucherId, number, totalPaise: built.computed.totalPaise };
    }

    return postEntryVoucher(db, input, fyId, number, now);
  });
}

/** Returns cannot take back more of an item than the original bill sold, less earlier returns. */
function assertReturnQuantities(db: Db, input: ItemVoucherInput, legacyImport: boolean): void {
  if (legacyImport || input.refVoucherId === undefined) return;
  if (input.type !== 'sales_return' && input.type !== 'purchase_return') return;
  const wanted = new Map<number, number>();
  for (const l of input.lines) wanted.set(l.itemId, (wanted.get(l.itemId) ?? 0) + l.qty);
  for (const [itemId, qty] of wanted) {
    const sold = row(
      db,
      'SELECT COALESCE(SUM(qty), 0) AS n FROM voucher_item WHERE voucher_id = ? AND item_id = ?',
      input.refVoucherId,
      itemId,
    );
    const name = String(row(db, 'SELECT name FROM item WHERE id = ?', itemId)?.['name']);
    if (Number(sold?.['n']) === 0) {
      throw new PostingError(`"${name}" is not on the bill you are returning against.`);
    }
    const returned = row(
      db,
      `SELECT COALESCE(SUM(vi.qty), 0) AS n FROM voucher_item vi JOIN voucher v ON v.id = vi.voucher_id
       WHERE v.ref_voucher_id = ? AND v.voucher_type = ? AND v.status = 'posted' AND vi.item_id = ?`,
      input.refVoucherId,
      input.type,
      itemId,
    );
    const remaining = Number(sold?.['n']) - Number(returned?.['n']);
    if (qty > remaining) {
      throw new PostingError(
        `You are returning more of "${name}" than the bill allows (bill ${Number(sold?.['n']) / 1000}, already returned ${Number(returned?.['n']) / 1000}).`,
      );
    }
  }
}

const CASH_BANK_GROUPS = ['Cash-in-Hand', 'Bank Accounts'];

function isCashOrBank(db: Db, accountId: number): boolean {
  const found = db
    .prepare(
      `WITH RECURSIVE up(id, name, parent_id) AS (
         SELECT g.id, g.name, g.parent_id FROM account a JOIN account_group g ON g.id = a.group_id WHERE a.id = ?
         UNION ALL SELECT g.id, g.name, g.parent_id FROM account_group g JOIN up ON g.id = up.parent_id)
       SELECT 1 FROM up WHERE name IN (${CASH_BANK_GROUPS.map(() => '?').join(',')}) LIMIT 1`,
    )
    .get(accountId, ...CASH_BANK_GROUPS);
  return found !== undefined;
}

/** Receipts and payments move cash or bank; journals and notes never do; contras move only cash and bank. */
function assertCashBankRules(db: Db, input: EntryVoucherInput): void {
  const cash = (e: { accountId: number }) => isCashOrBank(db, e.accountId);
  const dr = input.entries.filter((e) => e.side === 'dr');
  const cr = input.entries.filter((e) => e.side === 'cr');
  switch (input.type) {
    case 'receipt':
      if (!dr.some(cash) || cr.some(cash)) {
        throw new PostingError('A receipt must debit a Cash or Bank account and credit the party.');
      }
      break;
    case 'payment':
      if (!cr.some(cash) || dr.some(cash)) {
        throw new PostingError(
          'A payment must credit a Cash or Bank account and debit the party or expense.',
        );
      }
      break;
    case 'contra':
      if (!input.entries.every(cash)) {
        throw new PostingError(
          'A contra entry can only move money between Cash and Bank accounts.',
        );
      }
      break;
    default:
      if (input.entries.some(cash)) {
        throw new PostingError(
          'Cash and Bank accounts cannot be used here. Please use a Receipt, Payment or Contra.',
        );
      }
  }
}

function assertItemUnit(db: Db, itemId: number, unitId: number, qty: number): void {
  const item = row(db, 'SELECT name, unit_id FROM item WHERE id = ?', itemId);
  if (!item) throw new PostingError(`Item ${itemId} does not exist`);
  if (Number(item['unit_id']) !== unitId) {
    throw new PostingError(
      `"${String(item['name'])}" is counted in a different unit than the line uses.`,
    );
  }
  const unit = row(db, 'SELECT decimals FROM unit WHERE id = ?', unitId);
  if (Number(unit?.['decimals']) === 0 && qty % 1000 !== 0) {
    throw new PostingError(
      `"${String(item['name'])}" is counted in whole units; quantity must not have decimals.`,
    );
  }
}

function postStockVoucher(
  db: Db,
  input: StockVoucherInput,
  fyId: number,
  number: number,
  now: string,
): PostedVoucher {
  if (input.lines.length === 0) throw new PostingError('Please add at least one item.');
  const seen = new Set<number>();
  const movements: {
    itemId: number;
    unitId: number;
    shown: number;
    qtyIn: number;
    qtyOut: number;
    rate: number;
  }[] = [];

  if (input.type === 'stock_journal') {
    for (const l of input.lines) {
      if (l.qty <= 0) throw new PostingError('Item quantity must be greater than zero');
      assertItemUnit(db, l.itemId, l.unitId, l.qty);
      movements.push({
        itemId: l.itemId,
        unitId: l.unitId,
        shown: l.qty,
        qtyIn: l.direction === 'in' ? l.qty : 0,
        qtyOut: l.direction === 'out' ? l.qty : 0,
        rate: l.direction === 'in' ? (l.ratePaise ?? -1) : 0,
      });
    }
    if (!movements.some((m) => m.qtyIn > 0) || !movements.some((m) => m.qtyOut > 0)) {
      throw new PostingError('A stock journal needs items issued and items received.');
    }
    if (movements.some((m) => m.qtyIn > 0 && m.rate < 0)) {
      throw new PostingError('Please enter the cost per unit of the items received.');
    }
  } else {
    for (const l of input.lines) {
      if (l.countedQty < 0) throw new PostingError('The counted quantity cannot be negative.');
      if (seen.has(l.itemId)) throw new PostingError('An item appears twice in the stock count.');
      seen.add(l.itemId);
      assertItemUnit(db, l.itemId, l.unitId, l.countedQty);
      const book = row(
        db,
        `SELECT i.opening_qty + COALESCE((SELECT SUM(m.qty_in) - SUM(m.qty_out) FROM stock_movement m
           JOIN voucher v ON v.id = m.voucher_id
           WHERE m.item_id = i.id AND v.status = 'posted' AND m.date <= ?), 0) AS qty
         FROM item i WHERE i.id = ?`,
        input.date,
        l.itemId,
      );
      const diff = l.countedQty - Number(book?.['qty']);
      movements.push({
        itemId: l.itemId,
        unitId: l.unitId,
        shown: l.countedQty,
        qtyIn: diff > 0 ? diff : 0,
        qtyOut: diff < 0 ? -diff : 0,
        rate: 0,
      });
    }
  }

  const voucherId = insertHeader(
    db,
    {
      type: input.type,
      seriesId: input.seriesId,
      date: input.date,
      fyId,
      number,
      partyAccountId: null,
      saleTypeId: null,
      input,
      totalPaise: 0,
    },
    now,
  );
  const insertLine = db.prepare(
    `INSERT INTO voucher_item (voucher_id, line_no, item_id, qty, unit_id, list_price_paise, disc_bp, price_paise, amount_paise)
     VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0)`,
  );
  const insertStock = db.prepare(
    'INSERT INTO stock_movement (voucher_id, item_id, qty_in, qty_out, rate_paise, date) VALUES (?, ?, ?, ?, ?, ?)',
  );
  movements.forEach((m, i) => {
    insertLine.run(voucherId, i + 1, m.itemId, m.shown, m.unitId);
    if (m.qtyIn > 0 || m.qtyOut > 0)
      insertStock.run(voucherId, m.itemId, m.qtyIn, m.qtyOut, Math.max(m.rate, 0), input.date);
  });
  audit(db, now, input.createdBy, 'create', voucherId);
  return { voucherId, number, totalPaise: 0 };
}

function postEntryVoucher(
  db: Db,
  input: EntryVoucherInput,
  fyId: number,
  number: number,
  now: string,
): PostedVoucher {
  if (input.entries.length < 2) throw new PostingError('A voucher needs at least two entries');
  assertCashBankRules(db, input);
  const debit = input.entries.filter((e) => e.side === 'dr').reduce((a, e) => a + e.amountPaise, 0);
  const totalPaise = debit;
  const voucherId = insertHeader(
    db,
    {
      type: input.type,
      seriesId: input.seriesId,
      date: input.date,
      fyId,
      number,
      partyAccountId: input.partyAccountId ?? null,
      saleTypeId: null,
      input,
      totalPaise,
    },
    now,
  );
  writeJournal(db, voucherId, input.entries);
  assertBalanced(db, voucherId);
  audit(db, now, input.createdBy, 'create', voucherId);
  return { voucherId, number, totalPaise };
}

/**
 * Cancels a posted voucher by inserting exact reversal journal and stock lines. Original
 * rows are never touched; the voucher keeps its number and is marked cancelled.
 */
export function cancelVoucher(
  db: Db,
  voucherId: number,
  opts: {
    userId?: number | undefined;
    now?: string;
    role?: 'owner' | 'staff';
    reason?: string | undefined;
  } = {},
): void {
  const now = opts.now ?? new Date().toISOString();
  transaction(db, () => {
    const v = row(
      db,
      `SELECT v.status, v.date, f.is_locked FROM voucher v JOIN financial_year f ON f.id = v.fy_id WHERE v.id = ?`,
      voucherId,
    );
    if (!v) throw new PostingError(`Voucher ${voucherId} does not exist`);
    if (v['is_locked'])
      throw new PostingError(`The financial year of voucher ${voucherId} is locked`);
    assertDateOpen(db, String(v['date']), opts.role);
    if (v['status'] !== 'posted')
      throw new PostingError(`Voucher ${voucherId} is ${String(v['status'])}, not posted`);

    const lines = db
      .prepare(
        'SELECT account_id, dr_paise, cr_paise FROM journal_line WHERE voucher_id = ? AND is_reversal = 0 ORDER BY line_no',
      )
      .all(voucherId);
    const base = Number(
      row(
        db,
        'SELECT COALESCE(MAX(line_no), 0) AS n FROM journal_line WHERE voucher_id = ?',
        voucherId,
      )?.['n'],
    );
    const insertJournal = db.prepare(
      'INSERT INTO journal_line (voucher_id, account_id, dr_paise, cr_paise, line_no, is_reversal) VALUES (?, ?, ?, ?, ?, 1)',
    );
    lines.forEach((l, i) =>
      insertJournal.run(
        voucherId,
        Number(l['account_id']),
        Number(l['cr_paise']),
        Number(l['dr_paise']),
        base + i + 1,
      ),
    );

    const stock = db
      .prepare(
        'SELECT item_id, qty_in, qty_out, rate_paise, date FROM stock_movement WHERE voucher_id = ? AND is_reversal = 0',
      )
      .all(voucherId);
    const insertStock = db.prepare(
      'INSERT INTO stock_movement (voucher_id, item_id, qty_in, qty_out, rate_paise, date, is_reversal) VALUES (?, ?, ?, ?, ?, ?, 1)',
    );
    for (const s of stock) {
      insertStock.run(
        voucherId,
        Number(s['item_id']),
        Number(s['qty_out']),
        Number(s['qty_in']),
        Number(s['rate_paise']),
        String(s['date']),
      );
    }

    const before = row(db, 'SELECT * FROM voucher WHERE id = ?', voucherId);
    db.prepare("UPDATE voucher SET status = 'cancelled', modified_at = ? WHERE id = ?").run(
      now,
      voucherId,
    );
    const after = row(db, 'SELECT * FROM voucher WHERE id = ?', voucherId);
    db.prepare(
      'INSERT INTO audit_log (at, user_id, action, table_name, row_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      now,
      opts.userId ?? null,
      'cancel',
      'voucher',
      voucherId,
      JSON.stringify(before),
      JSON.stringify({ ...after, cancelReason: opts.reason ?? null }),
    );
    if (lines.length > 0) assertBalanced(db, voucherId); // stock-only vouchers have no journal
  });
}
