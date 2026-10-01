import { join } from 'node:path';
import { app } from 'electron';
import { loadMigrationsFromDir, migrate, openDatabase, type Db } from '@shopledger/core';

export interface OpenedDatabase {
  db: Db;
  path: string;
}

function resolveDbPath(): string {
  return process.env['SHOPLEDGER_DB_PATH'] ?? join(app.getPath('userData'), 'shopledger.db');
}

function resolveMigrationsDir(): string {
  // Packaged: electron-builder copies packages/core/migrations to <resources>/migrations (electron-builder.yml).
  return app.isPackaged
    ? join(process.resourcesPath, 'migrations')
    : join(import.meta.dirname, '../../../../packages/core/migrations');
}

/** Opens the shop database and brings its schema up to date. Throws on any problem. */
export function openShopDatabase(): OpenedDatabase {
  const path = resolveDbPath();
  const db = openDatabase(path);
  try {
    migrate(db, loadMigrationsFromDir(resolveMigrationsDir()));
  } catch (error) {
    db.close();
    throw error;
  }
  return { db, path };
}
