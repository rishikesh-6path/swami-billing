import { join } from 'node:path';
import { openDatabase, type Db } from '../../src/db/connection.ts';
import { loadMigrationsFromDir, migrate } from '../../src/db/migrations.ts';

export const MIGRATIONS_DIR = join(import.meta.dirname, '../../migrations');

/** In-memory database built from the real migrations, so schema drift fails tests. */
export function freshDb(): Db {
  const db = openDatabase(':memory:');
  migrate(db, loadMigrationsFromDir(MIGRATIONS_DIR));
  return db;
}
