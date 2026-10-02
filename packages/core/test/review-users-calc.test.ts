import { describe, expect, it } from 'vitest';
import { calculate, createUser, login, ValidationError } from '../src/index.ts';
import { freshDb } from './helpers/db.ts';

describe('review: calculator', () => {
  it('deeply nested brackets give a plain ValidationError, not a stack overflow', () => {
    const n = 50_000;
    expect(() => calculate('('.repeat(n) + '1' + ')'.repeat(n))).toThrow(ValidationError);
  });

  it('rounds half away from zero, the same for negative results', () => {
    expect(calculate('-0.00005')).toBe(-calculate('0.00005'));
  });

  it('never returns negative zero', () => {
    expect(Object.is(calculate('0*-1'), -0)).toBe(false);
  });
});

describe('review: PINs', () => {
  it('refuses trivially guessable PINs', () => {
    const db = freshDb();
    for (const pin of ['0000', '1234', '1111', '123456'])
      expect(() => createUser(db, { name: `u${pin}`, pin, role: 'staff' })).toThrow();
  });

  it('records a lock-out in the audit log so the owner can see who was guessing', () => {
    const db = freshDb();
    createUser(db, { name: 'Owner', pin: '4821', role: 'owner' });
    createUser(db, { name: 'Ravi', pin: '7364', role: 'staff' });
    const ctx = { now: '2026-10-15T10:00:00.000Z' };
    for (let i = 0; i < 5; i++) expect(() => login(db, 'Ravi', '0000', ctx)).toThrow();
    const rows = db
      .prepare(
        "SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE '%lock%' OR action LIKE '%login%'",
      )
      .get();
    expect(Number(rows?.['n'])).toBeGreaterThan(0);
  });
});

describe('review: unlocking', () => {
  it('is recorded as an unlock, not as a new sign-in', () => {
    const db = freshDb();
    createUser(db, { name: 'Ravi', role: 'staff', pin: '4821' });
    const id = Number(db.prepare('SELECT id FROM user WHERE name = ?').get('Ravi')?.['id']);
    login(db, 'Ravi', '4821', { userId: id }, 'unlock');
    const actions = db
      .prepare('SELECT action FROM audit_log WHERE action IN (?, ?)')
      .all('login', 'unlock');
    expect(actions.map((r) => r['action'])).toEqual(['unlock']);
  });
});
