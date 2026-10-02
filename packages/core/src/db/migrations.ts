import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transaction, type Db } from './connection.ts';

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

/** The newest schema this build understands. A test checks it against the migration files. */
export const LATEST_SCHEMA_VERSION = 10;

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex');
}

/**
 * Reads `NNNN_name.sql` files from a directory. Numbers must be contiguous from 0001 so a
 * missing or misnumbered file is caught before anything touches the database.
 */
export function loadMigrationsFromDir(dir: string): Migration[] {
  const migrations = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file): Migration => {
      const match = FILE_PATTERN.exec(file);
      if (!match) throw new MigrationError(`Migration file "${file}" must be named NNNN_name.sql`);
      const sql = readFileSync(join(dir, file), 'utf8');
      return { version: Number(match[1]), name: match[2] ?? '', sql, checksum: checksumOf(sql) };
    });
  migrations.forEach((m, index) => {
    if (m.version !== index + 1) {
      throw new MigrationError(
        `Migrations must be numbered 0001.. without gaps: expected ${String(index + 1).padStart(4, '0')}, found ${String(m.version).padStart(4, '0')}`,
      );
    }
  });
  return migrations;
}

function ensureSchemaVersionTable(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT
  `);
}

export function currentSchemaVersion(db: Db): number {
  ensureSchemaVersionTable(db);
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version').get();
  return Number(row?.['v'] ?? 0);
}

/**
 * Applies one migration and records it, atomically. Refuses a version that is already
 * recorded. Migration SQL must not use PRAGMAs that cannot run inside a transaction.
 */
export function applyMigration(db: Db, migration: Migration): void {
  ensureSchemaVersionTable(db);
  transaction(db, () => {
    const existing = db
      .prepare('SELECT 1 AS found FROM schema_version WHERE version = ?')
      .get(migration.version);
    if (existing) {
      throw new MigrationError(`Migration ${migration.version} is already applied`);
    }
    db.exec(migration.sql);
    db.prepare(
      'INSERT INTO schema_version (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
    ).run(migration.version, migration.name, migration.checksum, new Date().toISOString());
  });
}

/**
 * Brings the database up to date. Applied migrations are verified against the files on
 * disk (editing an applied migration is an error), then pending ones run in order.
 * Returns the versions applied by this call.
 */
export function migrate(db: Db, migrations: Migration[]): number[] {
  ensureSchemaVersionTable(db);
  const applied = db
    .prepare('SELECT version, name, checksum FROM schema_version ORDER BY version')
    .all();
  const byVersion = new Map(migrations.map((m) => [m.version, m]));

  for (const row of applied) {
    const version = Number(row['version']);
    const known = byVersion.get(version);
    if (!known) {
      throw new MigrationError(
        `Database is at schema version ${version}, which this app does not know. It was probably created by a newer version of ShopLedger.`,
      );
    }
    if (known.checksum !== row['checksum']) {
      throw new MigrationError(
        `Migration ${version} (${known.name}) was edited after it was applied. Add a new migration instead.`,
      );
    }
  }

  const appliedVersions = new Set(applied.map((row) => Number(row['version'])));
  const done: number[] = [];
  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue;
    applyMigration(db, migration);
    done.push(migration.version);
  }
  return done;
}
