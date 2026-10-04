import { transaction, type Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import { writeAudit, nowOf, type Ctx } from '../audit.ts';

/** The kinds of bill that can be set aside. */
export const HOLDABLE = ['sales', 'purchase', 'sales_return', 'purchase_return'] as const;

/** A set-aside bill that was not taken back within this many days is dropped. */
export const HELD_DAYS = 7;
/** One person may set aside this many bills at a time. */
export const HELD_MAX = 20;
const MAX_PAYLOAD = 200_000;

export interface HeldBill {
  id: number;
  kind: string;
  label: string;
  createdAt: string;
  userId: number;
  userName: string;
}

interface Who {
  userId: number;
  /** The owner sees everyone's set-aside bills; staff see their own. */
  isOwner: boolean;
}

/** Sets a half-made bill aside. `payload` is whatever the bill screen needs to rebuild itself. */
export function holdBill(
  db: Db,
  args: { kind: string; userId: number; label: string; payload: unknown },
  ctx: Ctx = {},
): number {
  if (!(HOLDABLE as readonly string[]).includes(args.kind)) {
    throw new ValidationError('That kind of bill cannot be set aside.');
  }
  const label = args.label.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (label === '') throw new ValidationError('Please give the set-aside bill a name.');
  const payload = JSON.stringify(args.payload ?? null);
  if (payload.length > MAX_PAYLOAD) {
    throw new ValidationError('This bill is too big to set aside. Please save it instead.');
  }
  return transaction(db, () => {
    const mine = Number(
      db.prepare('SELECT COUNT(*) AS n FROM held_bill WHERE user_id = ?').get(args.userId)?.['n'],
    );
    if (mine >= HELD_MAX) {
      throw new ValidationError(
        `You already have ${HELD_MAX} bills set aside. Please finish or throw away some first.`,
      );
    }
    const id = Number(
      db
        .prepare(
          'INSERT INTO held_bill (kind, user_id, label, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(args.kind, args.userId, label, payload, nowOf(ctx)).lastInsertRowid,
    );
    writeAudit(
      db,
      { ...ctx, userId: args.userId },
      {
        action: 'bill_held',
        table: 'held_bill',
        rowId: id,
        after: { kind: args.kind, label },
      },
    );
    return id;
  });
}

/** The set-aside bills this person may see, newest first. Old ones are dropped first. */
export function listHeld(db: Db, who: Who, ctx: Ctx = {}): HeldBill[] {
  const cutoff = new Date(Date.parse(nowOf(ctx)) - HELD_DAYS * 86_400_000).toISOString();
  db.prepare('DELETE FROM held_bill WHERE created_at < ?').run(cutoff);
  return db
    .prepare(
      `SELECT h.id, h.kind, h.label, h.created_at, h.user_id, u.name AS user_name
       FROM held_bill h JOIN user u ON u.id = h.user_id
       WHERE (? = 1 OR h.user_id = ?)
       ORDER BY h.created_at DESC, h.id DESC`,
    )
    .all(who.isOwner ? 1 : 0, who.userId)
    .map((r) => ({
      id: Number(r['id']),
      kind: String(r['kind']),
      label: String(r['label']),
      createdAt: String(r['created_at']),
      userId: Number(r['user_id']),
      userName: String(r['user_name']),
    }));
}

function find(db: Db, id: number, who: Who) {
  const row = db
    .prepare('SELECT id, kind, label, user_id, payload_json FROM held_bill WHERE id = ?')
    .get(id);
  if (!row || (!who.isOwner && Number(row['user_id']) !== who.userId)) {
    throw new ValidationError('That set-aside bill is no longer there.');
  }
  return row;
}

/** Takes a set-aside bill back: returns what was saved and removes it from the list. */
export function takeHeld(
  db: Db,
  id: number,
  who: Who,
  ctx: Ctx = {},
): { kind: string; label: string; payload: unknown } {
  return transaction(db, () => {
    const row = find(db, id, who);
    db.prepare('DELETE FROM held_bill WHERE id = ?').run(id);
    writeAudit(
      db,
      { ...ctx, userId: who.userId },
      {
        action: 'bill_resumed',
        table: 'held_bill',
        rowId: id,
      },
    );
    return {
      kind: String(row['kind']),
      label: String(row['label']),
      payload: JSON.parse(String(row['payload_json'])) as unknown,
    };
  });
}

/** Throws a set-aside bill away. */
export function discardHeld(db: Db, id: number, who: Who, ctx: Ctx = {}): void {
  transaction(db, () => {
    const row = find(db, id, who);
    db.prepare('DELETE FROM held_bill WHERE id = ?').run(id);
    writeAudit(
      db,
      { ...ctx, userId: who.userId },
      {
        action: 'bill_discarded',
        table: 'held_bill',
        rowId: id,
        before: { label: String(row['label']) },
      },
    );
  });
}

/** How many set-aside bills this person has (shown on the home screen). */
export function heldCount(db: Db, who: Who): number {
  return Number(
    db
      .prepare('SELECT COUNT(*) AS n FROM held_bill WHERE (? = 1 OR user_id = ?)')
      .get(who.isOwner ? 1 : 0, who.userId)?.['n'],
  );
}
