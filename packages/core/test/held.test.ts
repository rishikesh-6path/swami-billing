import { describe, expect, it } from 'vitest';
import {
  createUser,
  discardHeld,
  HELD_MAX,
  heldCount,
  holdBill,
  listHeld,
  takeHeld,
  ValidationError,
} from '../src/index.ts';
import { freshDb } from './helpers/db.ts';

function shop() {
  const db = freshDb();
  createUser(db, { name: 'Owner', pin: '4821', role: 'owner' });
  createUser(db, { name: 'Ravi', pin: '7364', role: 'staff' });
  createUser(db, { name: 'Mani', pin: '5927', role: 'staff' });
  const idOf = (n: string) =>
    Number(db.prepare('SELECT id FROM user WHERE name = ?').get(n)?.['id']);
  return { db, owner: idOf('Owner'), ravi: idOf('Ravi'), mani: idOf('Mani') };
}

describe('set-aside bills', () => {
  it('keeps what was typed and gives it back once', () => {
    const s = shop();
    const payload = { rows: [{ text: 'GI ELBOW', qty: '3' }], party: { id: 5, name: 'Kumar' } };
    const id = holdBill(s.db, { kind: 'sales', userId: s.ravi, label: 'Kumar 10:15', payload });
    expect(heldCount(s.db, { userId: s.ravi, isOwner: false })).toBe(1);
    expect(takeHeld(s.db, id, { userId: s.ravi, isOwner: false })).toEqual({
      kind: 'sales',
      label: 'Kumar 10:15',
      payload,
    });
    expect(heldCount(s.db, { userId: s.ravi, isOwner: false })).toBe(0);
    expect(() => takeHeld(s.db, id, { userId: s.ravi, isOwner: false })).toThrow(ValidationError);
  });

  it('has no effect on the books: no voucher, no journal line, no stock', () => {
    const s = shop();
    holdBill(s.db, { kind: 'sales', userId: s.ravi, label: 'x', payload: {} });
    for (const table of ['voucher', 'journal_line', 'stock_movement', 'voucher_item']) {
      const n = Number(s.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.['n']);
      expect(n, table).toBe(0);
    }
  });

  it('shows staff only their own, and the owner everyone', () => {
    const s = shop();
    const a = holdBill(s.db, { kind: 'sales', userId: s.ravi, label: 'A', payload: {} });
    holdBill(s.db, { kind: 'sales', userId: s.mani, label: 'B', payload: {} });
    expect(listHeld(s.db, { userId: s.ravi, isOwner: false }).map((h) => h.label)).toEqual(['A']);
    expect(listHeld(s.db, { userId: s.owner, isOwner: true })).toHaveLength(2);
    expect(() => takeHeld(s.db, a, { userId: s.mani, isOwner: false })).toThrow(ValidationError);
    expect(() => discardHeld(s.db, a, { userId: s.mani, isOwner: false })).toThrow(ValidationError);
    discardHeld(s.db, a, { userId: s.owner, isOwner: true });
    expect(listHeld(s.db, { userId: s.ravi, isOwner: false })).toEqual([]);
  });

  it('drops bills older than a week and limits how many one person keeps', () => {
    const s = shop();
    holdBill(
      s.db,
      { kind: 'sales', userId: s.ravi, label: 'old', payload: {} },
      { now: '2026-10-01T10:00:00.000Z' },
    );
    expect(
      listHeld(s.db, { userId: s.ravi, isOwner: false }, { now: '2026-10-07T10:00:00.000Z' }),
    ).toHaveLength(1);
    expect(
      listHeld(s.db, { userId: s.ravi, isOwner: false }, { now: '2026-10-09T10:00:00.000Z' }),
    ).toEqual([]);
    for (let i = 0; i < HELD_MAX; i++)
      holdBill(s.db, { kind: 'purchase', userId: s.ravi, label: `b${i}`, payload: {} });
    expect(() =>
      holdBill(s.db, { kind: 'purchase', userId: s.ravi, label: 'one too many', payload: {} }),
    ).toThrow(/set aside/);
  });

  it('refuses unknown kinds, empty names and huge payloads, and audits hold, resume and discard', () => {
    const s = shop();
    expect(() =>
      holdBill(s.db, { kind: 'journal', userId: s.ravi, label: 'x', payload: {} }),
    ).toThrow(ValidationError);
    expect(() =>
      holdBill(s.db, { kind: 'sales', userId: s.ravi, label: '  ', payload: {} }),
    ).toThrow(ValidationError);
    expect(() =>
      holdBill(s.db, { kind: 'sales', userId: s.ravi, label: 'big', payload: 'x'.repeat(300_000) }),
    ).toThrow(ValidationError);
    const a = holdBill(s.db, { kind: 'sales', userId: s.ravi, label: 'A', payload: {} });
    takeHeld(s.db, a, { userId: s.ravi, isOwner: false });
    const b = holdBill(s.db, { kind: 'sales', userId: s.ravi, label: 'B', payload: {} });
    discardHeld(s.db, b, { userId: s.ravi, isOwner: false });
    const actions = s.db
      .prepare("SELECT action FROM audit_log WHERE action LIKE 'bill_%' ORDER BY id")
      .all()
      .map((r) => r['action']);
    expect(actions).toEqual(['bill_held', 'bill_resumed', 'bill_held', 'bill_discarded']);
  });
});
