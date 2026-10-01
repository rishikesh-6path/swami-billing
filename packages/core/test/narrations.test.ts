import { describe, expect, it } from 'vitest';
import { DEFAULT_NARRATIONS, getNarrations, saveNarrations } from '../src/masters/narrations.ts';
import { freshDb } from './helpers/db.ts';

describe('standard notes', () => {
  it('start with the built-in list and keep what the owner saves, even an empty list', () => {
    const db = freshDb();
    expect(getNarrations(db, 'sales')).toEqual(DEFAULT_NARRATIONS.sales);
    expect(
      saveNarrations(db, 'sales', ['  Cash   sale ', 'cash sale', '', 'Site delivery']),
    ).toEqual(['Cash sale', 'Site delivery']);
    expect(getNarrations(db, 'sales')).toEqual(['Cash sale', 'Site delivery']);
    expect(getNarrations(db, 'purchase')).toEqual(DEFAULT_NARRATIONS.purchase);
    saveNarrations(db, 'sales', []);
    expect(getNarrations(db, 'sales')).toEqual([]);
  });

  it('refuses unknown kinds, long notes and too many notes in plain words', () => {
    const db = freshDb();
    expect(() => getNarrations(db, 'journal')).toThrow(/does not have standard notes/);
    expect(() => saveNarrations(db, 'sales', ['x'.repeat(81)])).toThrow(/too long/);
    expect(() =>
      saveNarrations(
        db,
        'sales',
        Array.from({ length: 21 }, (_, i) => `Note ${i}`),
      ),
    ).toThrow(/at most 20/);
  });

  it('writes an audit row when the list changes', () => {
    const db = freshDb();
    saveNarrations(db, 'sales', ['One'], { userId: undefined });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE table_name = 'setting'").get()?.['n'],
    ).toBe(1);
  });
});
