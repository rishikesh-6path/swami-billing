import { mkdtempSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkBackupFile,
  createBackup,
  loadMigrationsFromDir,
  migrate,
  openDatabase,
  restoreDatabaseFile,
  setSetting,
  getSetting,
} from '../src/index.ts';
import { MIGRATIONS_DIR, freshDb } from './helpers/db.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'review-backup-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function shopFile(path: string, marker: string): void {
  const db = openDatabase(path);
  migrate(db, loadMigrationsFromDir(MIGRATIONS_DIR));
  setSetting(db, 'marker', marker);
  db.close();
}

describe('review: backup and restore', () => {
  it('a backup from a newer app version (unknown schema version) is refused before the shop file is replaced', () => {
    const db = freshDb();
    const file = createBackup(db, join(dir, 'b'), '2026-10-15', '10:00:00');
    const raw = new DatabaseSync(file.path);
    raw.exec(
      "INSERT INTO schema_version (version, name, checksum, applied_at) VALUES (999, 'future', 'x', 'now')",
    );
    raw.close();
    // The app would fail to start on this file (migrate() throws "created by a newer version").
    expect(checkBackupFile(file.path).ok).toBe(false);
  });

  it('a file with only a voucher table and a setting table is not accepted as a backup', () => {
    const odd = join(dir, 'odd.db');
    const raw = new DatabaseSync(odd);
    raw.exec('CREATE TABLE voucher (id INTEGER); CREATE TABLE setting (key TEXT, value TEXT)');
    raw.close();
    expect(checkBackupFile(odd).ok).toBe(false);
  });

  it('restoring twice keeps the data that was live before the FIRST restore recoverable', () => {
    const live = join(dir, 'shop.db');
    shopFile(live, 'original');
    shopFile(join(dir, 'a.db'), 'backup-a');
    shopFile(join(dir, 'b.db'), 'backup-b');
    restoreDatabaseFile(join(dir, 'a.db'), live);
    restoreDatabaseFile(join(dir, 'b.db'), live);
    const holders = readdirSync(dir).filter((n) => {
      if (n === 'shop.db' || n === 'a.db' || n === 'b.db') return false;
      let raw: DatabaseSync | undefined;
      try {
        raw = new DatabaseSync(join(dir, n), { readOnly: true });
        const v = raw.prepare("SELECT value FROM setting WHERE key = 'marker'").get()?.['value'];
        return v === 'original';
      } catch {
        return false;
      } finally {
        // a file left open cannot be deleted on Windows
        raw?.close();
      }
    });
    expect(holders).not.toEqual([]); // currently .before-restore is overwritten with the state "backup-a"
  });

  it('createBackup refuses a date or time that would not produce a listable name inside the folder', () => {
    const db = freshDb();
    const folder = join(dir, 'b');
    expect(() => createBackup(db, folder, '../../../escape', '10:00:00')).toThrow();
    expect(existsSync(join(dir, 'escape-100000.db'))).toBe(false);
    // "14:00" (no seconds) writes shopledger-<date>-1400.db, which listBackups/pruneBackups never see
    expect(() => createBackup(db, folder, '2026-10-15', '14:00')).toThrow();
    void getSetting;
  });
});
