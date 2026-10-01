import { transaction, type Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import { getSetting, setSetting } from '../settings.ts';
import { writeAudit, type Ctx } from '../audit.ts';

export const NARRATION_KINDS = ['sales', 'purchase', 'sales_return', 'purchase_return'] as const;
export type NarrationKind = (typeof NARRATION_KINDS)[number];

/** The notes offered on F4 until the owner changes them in Settings. */
export const DEFAULT_NARRATIONS: Record<NarrationKind, string[]> = {
  sales: ['Being goods sold', 'Cash sale', 'Goods sold on credit', 'Delivered at site'],
  purchase: ['Being goods purchased', 'Goods purchased on credit', 'Goods received'],
  sales_return: ['Goods returned by customer', 'Damaged goods returned', 'Wrong item returned'],
  purchase_return: ['Goods returned to supplier', 'Damaged goods returned'],
};

const key = (kind: NarrationKind) => `narrations.${kind}`;

function assertKind(kind: string): asserts kind is NarrationKind {
  if (!(NARRATION_KINDS as readonly string[]).includes(kind)) {
    throw new ValidationError('That kind of bill does not have standard notes.');
  }
}

/** Notes for a kind of bill: what the owner saved, or the built-in list if nothing was saved. */
export function getNarrations(db: Db, kind: string): string[] {
  assertKind(kind);
  const stored = getSetting(db, key(kind));
  if (stored === undefined) return [...DEFAULT_NARRATIONS[kind]];
  return stored.split('\n').filter((n) => n !== '');
}

/** Saves the list (one note per line is the screen's job). Blank lines are dropped, repeats removed. */
export function saveNarrations(db: Db, kind: string, notes: string[], ctx: Ctx = {}): string[] {
  assertKind(kind);
  const clean: string[] = [];
  for (const raw of notes) {
    const note = raw.replace(/\s+/g, ' ').trim();
    if (note === '') continue;
    if (note.length > 80) {
      throw new ValidationError(
        `"${note.slice(0, 30)}..." is too long. Please keep each note under 80 letters.`,
      );
    }
    if (!clean.some((n) => n.toLowerCase() === note.toLowerCase())) clean.push(note);
  }
  if (clean.length > 20) throw new ValidationError('Please keep at most 20 standard notes.');
  transaction(db, () => {
    const before = getNarrations(db, kind);
    setSetting(db, key(kind), clean.join('\n'));
    writeAudit(db, ctx, { action: 'update', table: 'setting', rowId: 0, before, after: clean });
  });
  return clean;
}
