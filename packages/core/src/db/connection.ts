import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

export class DbIntegrityError extends Error {
  constructor(
    readonly path: string,
    readonly report: string[],
  ) {
    super(`Database integrity check failed for ${path}: ${report.join('; ')}`);
    this.name = 'DbIntegrityError';
  }
}

function pragmaValue(db: Db, pragma: string): string {
  const row = db.prepare(`PRAGMA ${pragma}`).get();
  if (!row) throw new Error(`PRAGMA ${pragma} returned no row`);
  return String(Object.values(row)[0]);
}

function runIntegrityCheck(db: Db, path: string): void {
  let report: string[];
  try {
    report = db
      .prepare('PRAGMA integrity_check')
      .all()
      .map((row) => String(Object.values(row)[0]));
  } catch (cause) {
    // A badly damaged file makes the pragma itself throw rather than return a report.
    throw new DbIntegrityError(path, [cause instanceof Error ? cause.message : String(cause)]);
  }
  if (report.length !== 1 || report[0] !== 'ok') {
    throw new DbIntegrityError(path, report);
  }
}

/**
 * Opens (creating if needed) a SQLite database with the pragmas the ledger depends on:
 * WAL, foreign keys, FULL synchronous (power-cut safety). Runs an integrity check before
 * returning. Pass ':memory:' for tests.
 */
export function openDatabase(path: string): Db {
  const db = new DatabaseSync(path);
  try {
    const inMemory = path === ':memory:';
    if (!inMemory) {
      const mode = db.prepare('PRAGMA journal_mode = WAL').get();
      const applied = mode ? String(Object.values(mode)[0]).toLowerCase() : '';
      if (applied !== 'wal') throw new Error(`Could not enable WAL mode (got "${applied}")`);
    }
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA busy_timeout = 5000');
    if (pragmaValue(db, 'foreign_keys') !== '1') throw new Error('Could not enable foreign keys');
    runIntegrityCheck(db, path);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

let savepointCounter = 0;

/**
 * Runs `fn` inside a transaction: commit on return, roll back on throw.
 * Outermost call uses BEGIN IMMEDIATE (single-writer, fails fast on lock contention);
 * nested calls use savepoints so an inner failure unwinds only the inner work.
 * `fn` must be synchronous: node:sqlite is synchronous and an awaited gap would leave
 * the transaction open.
 */
export function transaction<T>(db: Db, fn: () => T): T {
  const nested = db.isTransaction;
  const savepoint = `sp_${++savepointCounter}`;
  db.exec(nested ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
  try {
    const result = fn();
    if (result instanceof Promise) {
      throw new Error('transaction() callback must be synchronous');
    }
    db.exec(nested ? `RELEASE ${savepoint}` : 'COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) {
      db.exec(nested ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
    }
    throw error;
  }
}
