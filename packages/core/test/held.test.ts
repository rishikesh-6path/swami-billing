import { describe, expect, it } from 'vitest';
import {
  createUser,
  discardHeld,
  HELD_MAX,
  heldCount,
  holdBill,
  listHeld,
  peekHeld,
  finishHeld,
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
  it('keeps what was typed, and keeps the bill until it is finished', () => {
    const s = shop();
    const payload = { rows: [{ text: 'GI ELBOW', qty: '3' }], party: { id: 5, name: 'Kumar' } };
    const id = holdBill(s.db, { kind: 'sales', userId: s.ravi, label: 'Kumar 10:15', payload });
    expect(heldCount(s.db, { userId: s.ravi, isOwner: false })).toBe(1);
    expect(peekHeld(s.db, id, { userId: s.ravi, isOwner: false })).toEqual({
      kind: 'sales',
      label: 'Kumar 10:15',
      payload,
    });
    // opening it takes nothing away: a power cut at this moment loses no bill
    expect(heldCount(s.db, { userId: s.ravi, isOwner: false })).toBe(1);
    finishHeld(s.db, id, { userId: s.ravi, isOwner: false });
    expect(heldCount(s.db, { userId: s.ravi, isOwner: false })).toBe(0);
    expect(() => peekHeld(s.db, id, { userId: s.ravi, isOwner: false })).toThrow(ValidationError);
    finishHeld(s.db, id, { userId: s.ravi, isOwner: false }); // finishing twice is harmless
  });

  it('says plainly when a stored bill is damaged, and still lets it be thrown away', () => {
    const s = shop();
    const id = holdBill(s.db, { kind: 'sales', userId: s.ravi, label: 'x', payload: {} });
    s.db.prepare("UPDATE held_bill SET payload_json = '{not json' WHERE id = ?").run(id);
    expect(() => peekHeld(s.db, id, { userId: s.ravi, isOwner: false })).toThrow(
      /cannot be opened/,
    );
    discardHeld(s.db, id, { userId: s.ravi, isOwner: false });
    expect(heldCount(s.db, { userId: s.ravi, isOwner: false })).toBe(0);
  });

  it('does not count expired bills towards the limit of bills one person may keep', () => {
    const s = shop();
    for (let i = 0; i < HELD_MAX; i++)
      holdBill(
        s.db,
        { kind: 'sales', userId: s.ravi, label: `old ${i}`, payload: {} },
        { now: '2026-10-01T10:00:00.000Z' },
      );
    expect(
      holdBill(
        s.db,
        { kind: 'sales', userId: s.ravi, label: 'new', payload: {} },
        { now: '2026-10-20T10:00:00.000Z' },
      ),
    ).toBeGreaterThan(0);
  });

  it('counts only bills that are still kept, and records the ones that expire', () => {
    const s = shop();
    holdBill(
      s.db,
      { kind: 'sales', userId: s.ravi, label: 'old', payload: {} },
      { now: '2026-10-01T10:00:00.000Z' },
    );
    const who = { userId: s.ravi, isOwner: false };
    expect(heldCount(s.db, who, { now: '2026-10-05T10:00:00.000Z' })).toBe(1);
    expect(heldCount(s.db, who, { now: '2026-10-09T10:00:00.000Z' })).toBe(0);
    expect(listHeld(s.db, who, { now: '2026-10-09T10:00:00.000Z' })).toEqual([]);
    const n = Number(
      s.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'bill_expired'").get()?.[
        'n'
      ],
    );
    expect(n).toBe(1);
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
    expect(() => peekHeld(s.db, a, { userId: s.mani, isOwner: false })).toThrow(ValidationError);
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
    peekHeld(s.db, a, { userId: s.ravi, isOwner: false });
    const b = holdBill(s.db, { kind: 'sales', userId: s.ravi, label: 'B', payload: {} });
    discardHeld(s.db, b, { userId: s.ravi, isOwner: false });
    const actions = s.db
      .prepare("SELECT action FROM audit_log WHERE action LIKE 'bill_%' ORDER BY id")
      .all()
      .map((r) => r['action']);
    expect(actions).toEqual(['bill_held', 'bill_resumed', 'bill_held', 'bill_discarded']);
  });
});
