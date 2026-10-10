import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DbIntegrityError, openDatabase, transaction } from '../../src/db/connection.ts';
import { tempDir } from '../helpers/tmp.ts';

function value(db: ReturnType<typeof openDatabase>, pragma: string): unknown {
  const row = db.prepare(`PRAGMA ${pragma}`).get();
  return row ? Object.values(row)[0] : undefined;
}

describe('openDatabase', () => {
  it('opens an in-memory database with foreign keys enforced', () => {
    const db = openDatabase(':memory:');
    expect(value(db, 'foreign_keys')).toBe(1);
    db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
    db.exec('CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))');
    expect(() => db.exec('INSERT INTO child (parent_id) VALUES (99)')).toThrow(/FOREIGN KEY/);
    db.close();
  });

  it('opens an on-disk database in WAL mode with full synchronous', () => {
    const path = join(tempDir(), 'test.db');
    const db = openDatabase(path);
    expect(value(db, 'journal_mode')).toBe('wal');
    expect(value(db, 'synchronous')).toBe(2);
    expect(value(db, 'foreign_keys')).toBe(1);
    db.close();
  });

  it('refuses to open a corrupted database file', () => {
    const path = join(tempDir(), 'corrupt.db');
    const db = openDatabase(path);
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
    // one transaction: 2,000 separate disk syncs take half a minute on a Windows disk
    db.exec('BEGIN');
    for (let i = 0; i < 2000; i++) insert.run(`row-${i}-${'x'.repeat(50)}`);
    db.exec('COMMIT');
    db.close();

    const bytes = readFileSync(path);
    bytes.fill(0xff, 4096, 8192); // wipe the second page
    writeFileSync(path, bytes);

    expect(() => openDatabase(path)).toThrow(DbIntegrityError);
  });

  it('refuses to open a file that is not a database', () => {
    const path = join(tempDir(), 'garbage.db');
    writeFileSync(path, 'this is not a sqlite database'.repeat(200));
    expect(() => openDatabase(path)).toThrow();
  });
});

describe('transaction', () => {
  it('commits when the callback returns', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE t (v INTEGER)');
    const result = transaction(db, () => {
      db.exec('INSERT INTO t VALUES (1)');
      return 'done';
    });
    expect(result).toBe('done');
    expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 1 });
  });

  it('rolls back everything when the callback throws', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE t (v INTEGER)');
    expect(() =>
      transaction(db, () => {
        db.exec('INSERT INTO t VALUES (1)');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 0 });
    expect(db.isTransaction).toBe(false);
  });

  it('unwinds only the inner work when a nested transaction fails', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE t (v INTEGER)');
    transaction(db, () => {
      db.exec('INSERT INTO t VALUES (1)');
      expect(() =>
        transaction(db, () => {
          db.exec('INSERT INTO t VALUES (2)');
          throw new Error('inner');
        }),
      ).toThrow('inner');
    });
    expect(db.prepare('SELECT v FROM t').all()).toEqual([{ v: 1 }]);
  });

  it('rejects an asynchronous callback and leaves no open transaction', () => {
    const db = openDatabase(':memory:');
    expect(() => transaction(db, () => Promise.resolve(1))).toThrow(/synchronous/);
    expect(db.isTransaction).toBe(false);
  });
});
