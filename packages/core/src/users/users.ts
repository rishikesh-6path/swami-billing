import type { SQLOutputValue } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { writeAudit, type Ctx, nowOf } from '../audit.ts';
import { transaction, type Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import { requireName } from '../masters/validation.ts';
import { getSetting, setSetting } from '../settings.ts';
import type { Role } from '../books/control.ts';

export interface UserRow {
  id: number;
  name: string;
  role: Role;
  isActive: boolean;
}

const N = 2 ** 15;
const R = 8;
const P = 1;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 5;

/** scrypt, not argon2id: it ships with Node, so the app needs no native module. */
export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function pinMatches(pin: string, stored: string): boolean {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(pin, Buffer.from(salt, 'hex'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return timingSafeEqual(actual, expected);
}

/** All the same digit, a straight run up or down (1234, 4321), or two digits repeated (1212). */
function isEasyToGuess(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true;
  const steps = [...pin].slice(1).map((d, i) => Number(d) - Number(pin.charAt(i)));
  if (steps.every((x) => x === 1) || steps.every((x) => x === -1)) return true;
  return pin.length % 2 === 0 && pin === pin.slice(0, 2).repeat(pin.length / 2);
}

function cleanPin(pin: string, allowWeak = false): string {
  if (!/^\d{4,6}$/.test(pin)) throw new ValidationError('The PIN must be 4 to 6 digits.');
  if (!allowWeak && isEasyToGuess(pin)) {
    throw new ValidationError(
      'That PIN is too easy to guess. Please choose other digits, not a run like 1234 or the same digit repeated.',
    );
  }
  return pin;
}

const user = (r: Record<string, SQLOutputValue>): UserRow => ({
  id: Number(r['id']),
  name: String(r['name']),
  role: String(r['role']) as Role,
  isActive: Boolean(r['is_active']),
});

export function listUsers(db: Db): UserRow[] {
  return db.prepare('SELECT id, name, role, is_active FROM user ORDER BY name').all().map(user);
}

export function getUser(db: Db, id: number): UserRow | undefined {
  const found = db.prepare('SELECT id, name, role, is_active FROM user WHERE id = ?').get(id);
  return found ? user(found) : undefined;
}

export function createUser(
  db: Db,
  input: { name: string; pin: string; role: Role; allowWeakPin?: boolean },
  ctx: Ctx = {},
): number {
  const name = requireName(input.name, 'name');
  const pin = cleanPin(input.pin, input.allowWeakPin);
  return transaction(db, () => {
    if (db.prepare('SELECT 1 FROM user WHERE lower(name) = lower(?)').get(name)) {
      throw new ValidationError(`There is already a user named "${name}".`);
    }
    const id = Number(
      db
        .prepare('INSERT INTO user (name, pin_hash, role) VALUES (?, ?, ?)')
        .run(name, hashPin(pin), input.role).lastInsertRowid,
    );
    writeAudit(db, ctx, {
      action: 'create',
      table: 'user',
      rowId: id,
      after: { name, role: input.role },
    });
    return id;
  });
}

function activeOwners(db: Db, exceptId: number): number {
  return Number(
    db
      .prepare("SELECT COUNT(*) AS n FROM user WHERE role = 'owner' AND is_active = 1 AND id <> ?")
      .get(exceptId)?.['n'],
  );
}

export function updateUser(
  db: Db,
  id: number,
  patch: { role?: Role; isActive?: boolean },
  ctx: Ctx = {},
): void {
  transaction(db, () => {
    const before = getUser(db, id);
    if (!before) throw new ValidationError('That user no longer exists.');
    const role = patch.role ?? before.role;
    const isActive = patch.isActive ?? before.isActive;
    if (
      before.role === 'owner' &&
      before.isActive &&
      (role !== 'owner' || !isActive) &&
      activeOwners(db, id) === 0
    ) {
      throw new ValidationError('There must always be at least one owner who can sign in.');
    }
    db.prepare('UPDATE user SET role = ?, is_active = ? WHERE id = ?').run(
      role,
      isActive ? 1 : 0,
      id,
    );
    writeAudit(db, ctx, {
      action: 'update',
      table: 'user',
      rowId: id,
      before,
      after: getUser(db, id),
    });
  });
}

export function changePin(db: Db, id: number, newPin: string, ctx: Ctx = {}): void {
  const pin = cleanPin(newPin);
  transaction(db, () => {
    if (!getUser(db, id)) throw new ValidationError('That user no longer exists.');
    db.prepare('UPDATE user SET pin_hash = ? WHERE id = ?').run(hashPin(pin), id);
    setSetting(db, `auth.fail.${id}`, '');
    writeAudit(db, ctx, { action: 'change_pin', table: 'user', rowId: id });
  });
}

interface FailState {
  count: number;
  lockedUntil: string | null;
}

function failState(db: Db, id: number): FailState {
  try {
    const parsed = JSON.parse(
      getSetting(db, `auth.fail.${id}`) || '{"count":0,"lockedUntil":null}',
    ) as FailState;
    return { count: Number(parsed.count) || 0, lockedUntil: parsed.lockedUntil ?? null };
  } catch {
    return { count: 0, lockedUntil: null };
  }
}

/**
 * Signs a user in by name and PIN. After five wrong PINs in a row the account is locked for
 * five minutes. Messages never say whether the name or the PIN was wrong.
 */
export function login(db: Db, name: string, pin: string, ctx: Ctx = {}): UserRow {
  const now = nowOf(ctx);
  const found = db
    .prepare('SELECT id, name, role, is_active, pin_hash FROM user WHERE lower(name) = lower(?)')
    .get(name.trim());
  const wrong = new ValidationError('The name or PIN is not right. Please try again.');
  if (!found || !found['is_active']) throw wrong;

  const id = Number(found['id']);
  const state = failState(db, id);
  if (state.lockedUntil !== null && state.lockedUntil > now) {
    throw new ValidationError(
      'Too many wrong PINs. Please wait a few minutes and try again, or ask the owner.',
    );
  }
  if (!pinMatches(pin, String(found['pin_hash']))) {
    const count = state.count + 1;
    const lockedUntil =
      count >= MAX_FAILURES
        ? new Date(Date.parse(now) + LOCK_MINUTES * 60_000).toISOString()
        : null;
    transaction(db, () => {
      setSetting(
        db,
        `auth.fail.${id}`,
        JSON.stringify({ count: lockedUntil ? 0 : count, lockedUntil }),
      );
      const who = { ...ctx, userId: id };
      writeAudit(db, who, { action: 'login_failed', table: 'user', rowId: id, after: { count } });
      if (lockedUntil) {
        writeAudit(db, who, {
          action: 'login_locked',
          table: 'user',
          rowId: id,
          after: { lockedUntil },
        });
      }
    });
    throw wrong;
  }
  transaction(db, () => {
    setSetting(db, `auth.fail.${id}`, '');
    writeAudit(db, { ...ctx, userId: id }, { action: 'login', table: 'user', rowId: id });
  });
  return user(found);
}
