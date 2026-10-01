import type { SQLOutputValue } from 'node:sqlite';
import { writeAudit, type Ctx } from '../audit.ts';
import { transaction, type Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import { accountBalance } from '../reports/ledger.ts';
import { cleanParty, requireName, requireNonNegative } from './validation.ts';

type Row = Record<string, SQLOutputValue>;

export interface AccountGroupRow {
  id: number;
  name: string;
  parentId: number | null;
  nature: 'asset' | 'liability' | 'income' | 'expense';
  isSystem: boolean;
}

export interface AccountRow {
  id: number;
  name: string;
  groupId: number;
  groupName: string;
  openingBalancePaise: number;
  openingIsDr: boolean;
  gstin: string | null;
  stateCode: string | null;
  phone: string | null;
  address: string | null;
  creditDays: number;
  isSystem: boolean;
}

const group = (r: Row): AccountGroupRow => ({
  id: Number(r['id']),
  name: String(r['name']),
  parentId: r['parent_id'] === null ? null : Number(r['parent_id']),
  nature: String(r['nature']) as AccountGroupRow['nature'],
  isSystem: Boolean(r['is_system']),
});

const account = (r: Row): AccountRow => ({
  id: Number(r['id']),
  name: String(r['name']),
  groupId: Number(r['group_id']),
  groupName: String(r['group_name']),
  openingBalancePaise: Number(r['opening_balance_paise']),
  openingIsDr: Boolean(r['opening_is_dr']),
  gstin: r['gstin'] === null ? null : String(r['gstin']),
  stateCode: r['state_code'] === null ? null : String(r['state_code']),
  phone: r['phone'] === null ? null : String(r['phone']),
  address: r['address'] === null ? null : String(r['address']),
  creditDays: Number(r['credit_days']),
  isSystem: Boolean(r['is_system']),
});

const ACCOUNT_SELECT = `SELECT a.*, g.name AS group_name FROM account a JOIN account_group g ON g.id = a.group_id`;

export function listAccountGroups(db: Db): AccountGroupRow[] {
  return db.prepare('SELECT * FROM account_group ORDER BY name').all().map(group);
}

function nameTaken(db: Db, table: string, name: string, exceptId?: number): boolean {
  const row = db
    .prepare(`SELECT id FROM ${table} WHERE lower(name) = lower(?) AND id <> ?`)
    .get(name, exceptId ?? -1);
  return row !== undefined;
}

/** New sub-group under an existing group; it inherits the parent's nature. */
export function createAccountGroup(
  db: Db,
  input: { name: string; parentId: number },
  ctx: Ctx = {},
): number {
  const name = requireName(input.name, 'group name');
  return transaction(db, () => {
    const parent = db.prepare('SELECT nature FROM account_group WHERE id = ?').get(input.parentId);
    if (!parent) throw new ValidationError('Please choose the group this new group belongs under.');
    if (nameTaken(db, 'account_group', name)) {
      throw new ValidationError(`A group named "${name}" already exists.`);
    }
    const id = Number(
      db
        .prepare(
          'INSERT INTO account_group (name, parent_id, nature, is_system) VALUES (?, ?, ?, 0)',
        )
        .run(name, input.parentId, String(parent['nature'])).lastInsertRowid,
    );
    writeAudit(db, ctx, { action: 'create', table: 'account_group', rowId: id, after: { name } });
    return id;
  });
}

export interface AccountInput {
  name: string;
  groupId: number;
  openingBalancePaise?: number | undefined;
  openingIsDr?: boolean | undefined;
  gstin?: string | null | undefined;
  stateCode?: string | null | undefined;
  phone?: string | null | undefined;
  address?: string | null | undefined;
  creditDays?: number | undefined;
}

export function getAccount(db: Db, id: number): AccountRow | undefined {
  const row = db.prepare(`${ACCOUNT_SELECT} WHERE a.id = ?`).get(id);
  return row ? account(row) : undefined;
}

export function listAccounts(
  db: Db,
  args: { search?: string; groupId?: number } = {},
): AccountRow[] {
  const like = `%${(args.search ?? '').replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return db
    .prepare(
      `${ACCOUNT_SELECT} WHERE a.name LIKE ? ESCAPE '\\' AND (? IS NULL OR a.group_id = ?) ORDER BY a.name`,
    )
    .all(like, args.groupId ?? null, args.groupId ?? null)
    .map(account);
}

export function createAccount(db: Db, input: AccountInput, ctx: Ctx = {}): number {
  const name = requireName(input.name, 'account name');
  const party = cleanParty(input);
  const opening = requireNonNegative(input.openingBalancePaise, 'opening balance');
  const creditDays = requireNonNegative(input.creditDays, 'credit days');
  return transaction(db, () => {
    if (!db.prepare('SELECT 1 FROM account_group WHERE id = ?').get(input.groupId)) {
      throw new ValidationError('Please choose a group for this account.');
    }
    if (nameTaken(db, 'account', name)) {
      throw new ValidationError(`An account named "${name}" already exists.`);
    }
    const id = Number(
      db
        .prepare(
          `INSERT INTO account (name, group_id, opening_balance_paise, opening_is_dr, gstin, state_code, phone, address, credit_days)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          name,
          input.groupId,
          opening,
          input.openingIsDr === false ? 0 : 1,
          party.gstin,
          party.stateCode,
          party.phone,
          (input.address ?? '').trim() || null,
          creditDays,
        ).lastInsertRowid,
    );
    writeAudit(db, ctx, {
      action: 'create',
      table: 'account',
      rowId: id,
      after: getAccount(db, id),
    });
    return id;
  });
}

export function updateAccount(
  db: Db,
  id: number,
  patch: Partial<AccountInput>,
  ctx: Ctx = {},
): void {
  transaction(db, () => {
    const before = getAccount(db, id);
    if (!before) throw new ValidationError('That account no longer exists.');
    if (before.isSystem && (patch.name !== undefined || patch.groupId !== undefined)) {
      throw new ValidationError(
        `"${before.name}" is a built-in account; its name and group cannot be changed.`,
      );
    }
    const name = patch.name === undefined ? before.name : requireName(patch.name, 'account name');
    if (nameTaken(db, 'account', name, id)) {
      throw new ValidationError(`An account named "${name}" already exists.`);
    }
    const party = cleanParty({
      gstin: patch.gstin === undefined ? before.gstin : patch.gstin,
      stateCode: patch.stateCode === undefined ? before.stateCode : patch.stateCode,
      phone: patch.phone === undefined ? before.phone : patch.phone,
    });
    const groupId = patch.groupId ?? before.groupId;
    if (!db.prepare('SELECT 1 FROM account_group WHERE id = ?').get(groupId)) {
      throw new ValidationError('Please choose a group for this account.');
    }
    db.prepare(
      `UPDATE account SET name = ?, group_id = ?, opening_balance_paise = ?, opening_is_dr = ?, gstin = ?,
         state_code = ?, phone = ?, address = ?, credit_days = ? WHERE id = ?`,
    ).run(
      name,
      groupId,
      requireNonNegative(
        patch.openingBalancePaise ?? before.openingBalancePaise,
        'opening balance',
      ),
      (patch.openingIsDr ?? before.openingIsDr) ? 1 : 0,
      party.gstin,
      party.stateCode,
      party.phone,
      patch.address === undefined ? before.address : (patch.address ?? '').trim() || null,
      requireNonNegative(patch.creditDays ?? before.creditDays, 'credit days'),
      id,
    );
    writeAudit(db, ctx, {
      action: 'update',
      table: 'account',
      rowId: id,
      before,
      after: getAccount(db, id),
    });
  });
}

/** Only accounts that were never used in a voucher can be removed. */
export function deleteAccount(db: Db, id: number, ctx: Ctx = {}): void {
  transaction(db, () => {
    const before = getAccount(db, id);
    if (!before) return;
    if (before.isSystem)
      throw new ValidationError(`"${before.name}" is a built-in account and cannot be removed.`);
    const used =
      db.prepare('SELECT 1 FROM journal_line WHERE account_id = ? LIMIT 1').get(id) ??
      db.prepare('SELECT 1 FROM voucher WHERE party_account_id = ? LIMIT 1').get(id) ??
      db.prepare('SELECT 1 FROM bill_sundry WHERE account_id = ? LIMIT 1').get(id) ??
      db.prepare('SELECT 1 FROM voucher_settlement WHERE account_id = ? LIMIT 1').get(id);
    if (used) {
      throw new ValidationError(`"${before.name}" has entries in the books and cannot be removed.`);
    }
    db.prepare('DELETE FROM account WHERE id = ?').run(id);
    writeAudit(db, ctx, { action: 'delete', table: 'account', rowId: id, before });
  });
}

export interface PartyHit {
  id: number;
  name: string;
  gstin: string | null;
  stateCode: string | null;
  phone: string | null;
  creditDays: number;
  groupName: string;
  /** Positive = they owe us (Dr), negative = we owe them (Cr). */
  balancePaise: number;
}

export type PartyKind = 'customer' | 'supplier' | 'any';

/**
 * Finds customers or suppliers by name, phone or GST number for the bill screens. For customers
 * the built-in Cash account is offered too (a cash sale has no named customer). Each hit carries
 * the party's balance on `asOn` so staff can see what is owed before billing.
 */
export function searchParties(
  db: Db,
  args: { text: string; kind: PartyKind; asOn: string; limit?: number },
): PartyHit[] {
  const groups =
    args.kind === 'customer'
      ? ['Sundry Debtors']
      : args.kind === 'supplier'
        ? ['Sundry Creditors']
        : ['Sundry Debtors', 'Sundry Creditors'];
  const q = args.text.trim().toLowerCase();
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = db
    .prepare(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM account_group WHERE name IN (${groups.map(() => '?').join(',')})
         UNION ALL SELECT g.id FROM account_group g JOIN tree t ON g.parent_id = t.id)
       SELECT a.id, a.name, a.gstin, a.state_code, a.phone, a.credit_days, g.name AS group_name,
              CASE WHEN lower(a.name) = ? THEN 0 WHEN lower(a.name) LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END AS rank
       FROM account a JOIN account_group g ON g.id = a.group_id
       WHERE (a.group_id IN (SELECT id FROM tree) OR (? = 'customer' AND a.name = 'Cash' AND a.is_system = 1))
         AND (lower(a.name) LIKE ? ESCAPE '\\' OR COALESCE(a.phone, '') LIKE ? ESCAPE '\\' OR lower(COALESCE(a.gstin, '')) LIKE ? ESCAPE '\\')
       ORDER BY CASE WHEN a.name = 'Cash' AND a.is_system = 1 THEN 0 ELSE 1 END, rank, a.name LIMIT ?`,
    )
    .all(
      ...groups,
      q,
      `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
      args.kind,
      like,
      like,
      like,
      args.limit ?? 12,
    );
  return rows.map((r) => ({
    id: Number(r['id']),
    name: String(r['name']),
    gstin: r['gstin'] === null ? null : String(r['gstin']),
    stateCode: r['state_code'] === null ? null : String(r['state_code']),
    phone: r['phone'] === null ? null : String(r['phone']),
    creditDays: Number(r['credit_days']),
    groupName: String(r['group_name']),
    balancePaise: accountBalance(db, Number(r['id']), args.asOn),
  }));
}
