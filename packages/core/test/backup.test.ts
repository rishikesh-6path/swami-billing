import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backupFileName,
  backupReminder,
  checkBackupFile,
  copyBackupTo,
  createBackup,
  listBackups,
  loadMigrationsFromDir,
  migrate,
  openDatabase,
  pruneBackups,
  restoreDatabaseFile,
  seedDemoShop,
  type Db,
} from '../src/index.ts';
import { MIGRATIONS_DIR, freshDb } from './helpers/db.ts';

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'backup-test-'));
  db = freshDb();
  seedDemoShop(db, { today: '2026-10-15' });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('backup', () => {
  it('writes a checked copy that holds the same bills', () => {
    const file = createBackup(db, join(dir, 'b'), '2026-10-15', '14:00:00');
    expect(file.name).toBe('shopledger-2026-10-15-140000.db');
    const check = checkBackupFile(file.path);
    expect(check.ok).toBe(true);
    const live = Number(db.prepare('SELECT COUNT(*) AS n FROM voucher').get()?.['n']);
    expect(check.vouchers).toBe(live);
    expect(readdirSync(join(dir, 'b')).some((n) => n.endsWith('.partial'))).toBe(false);
  });

  it('rejects damaged and foreign files in plain words', () => {
    const junk = join(dir, 'junk.db');
    writeFileSync(junk, 'this is not a database at all');
    expect(checkBackupFile(junk)).toMatchObject({ ok: false });
    expect(checkBackupFile(join(dir, 'missing.db'))).toMatchObject({
      ok: false,
      message: 'That file could not be found.',
    });
  });

  it('keeps the newest backup of each of 30 days and of 12 months, nothing more', () => {
    const folder = join(dir, 'b');
    const file = createBackup(db, folder, '2026-10-15', '10:00:00');
    // fabricate history by copying the real file under many dated names
    const names: string[] = [];
    for (let m = 0; m < 24; m++) {
      const year = 2024 + Math.floor(m / 12);
      const month = String((m % 12) + 1).padStart(2, '0');
      for (const day of ['01', '15'])
        names.push(backupFileName(`${year}-${month}-${day}`, '09:00:00'));
    }
    for (let d = 1; d <= 31; d++) {
      const date = `2026-10-${String(d).padStart(2, '0')}`;
      names.push(backupFileName(date, '09:00:00'), backupFileName(date, '20:00:00'));
    }
    for (const n of names) writeFileSync(join(folder, n), readFileSync(file.path));
    pruneBackups(folder);
    const left = listBackups(folder);
    const days = new Set(left.map((f) => f.date));
    // 30 newest distinct days kept (one file each), older months keep one file per month
    const perDay = left.filter((f) => f.date.startsWith('2026-10'));
    expect(perDay.length).toBeLessThanOrEqual(30);
    expect(left.some((f) => f.date === '2026-10-31')).toBe(true);
    expect(left.filter((f) => f.date === '2026-10-31')).toHaveLength(1);
    expect(left.find((f) => f.date === '2026-10-31')?.name).toContain('200000'); // newest of that day
    expect(days.size).toBeLessThanOrEqual(30 + 12);
    const months = new Set(left.map((f) => f.date.slice(0, 7)));
    expect(months.size).toBeLessThanOrEqual(12 + 2);
    expect(left.length).toBeGreaterThan(0);
  });

  it('never prunes below one backup', () => {
    const folder = join(dir, 'b');
    createBackup(db, folder, '2020-01-01', '09:00:00');
    pruneBackups(folder);
    expect(listBackups(folder)).toHaveLength(1);
  });

  it('copies to a second place only when that place exists', () => {
    const file = createBackup(db, join(dir, 'b'), '2026-10-15', '14:00:00');
    expect(copyBackupTo(file, join(dir, 'no-such-drive', 'backups'))).toBe(false);
    expect(copyBackupTo(file, join(dir, 'usb'))).toBe(true);
    expect(existsSync(join(dir, 'usb', file.name))).toBe(true);
  });
});

describe('restore', () => {
  it('replaces the database with the backup and keeps the old file', () => {
    const live = join(dir, 'live.db');
    const first = openDatabase(live);
    migrate(first, loadMigrationsFromDir(MIGRATIONS_DIR));
    seedDemoShop(first, { today: '2026-10-15' });
    const file = createBackup(first, join(dir, 'b'), '2026-10-15', '14:00:00');
    const before = Number(first.prepare('SELECT COUNT(*) AS n FROM voucher').get()?.['n']);
    first
      .prepare("UPDATE setting SET value = 'changed' WHERE key = (SELECT key FROM setting LIMIT 1)")
      .run();
    first.close();

    const { kept } = restoreDatabaseFile(file.path, live);
    expect(kept).toBe(`${live}.before-restore`);
    expect(existsSync(kept ?? '')).toBe(true);
    const restored = openDatabase(live);
    expect(Number(restored.prepare('SELECT COUNT(*) AS n FROM voucher').get()?.['n'])).toBe(before);
    restored.close();
  });

  it('refuses a bad file and leaves the database alone', () => {
    const live = join(dir, 'live.db');
    const first = openDatabase(live);
    migrate(first, loadMigrationsFromDir(MIGRATIONS_DIR));
    seedDemoShop(first, { today: '2026-10-15' });
    first.close();
    const bad = join(dir, 'bad.db');
    writeFileSync(bad, 'nope');
    const sizeBefore = readFileSync(live).length;
    expect(() => restoreDatabaseFile(bad, live)).toThrow(/Nothing was changed/);
    expect(readFileSync(live).length).toBe(sizeBefore);
  });
});

describe('backup reminder', () => {
  it('stays quiet for a recent backup and speaks up otherwise', () => {
    expect(backupReminder('2026-10-14 20:00', '2026-10-15')).toBeNull();
    expect(backupReminder('2026-10-13 20:00', '2026-10-15')).toBeNull();
    expect(backupReminder('2026-10-10 20:00', '2026-10-15')).toMatch(/5 days ago/);
    expect(backupReminder(undefined, '2026-10-15')).toMatch(/No backup/);
  });
});
