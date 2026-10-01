import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Db } from '../db/connection.ts';
import { LATEST_SCHEMA_VERSION } from '../db/migrations.ts';
import { ValidationError } from '../errors.ts';

/** Backup files are named `shopledger-YYYY-MM-DD-HHMMSS.db` (shop time), so names sort by age. */
const NAME = /^shopledger-(\d{4})-(\d{2})-(\d{2})-(\d{6})\.db$/;

export interface BackupFile {
  name: string;
  path: string;
  /** YYYY-MM-DD, taken from the file name. */
  date: string;
  bytes: number;
}

export function backupFileName(date: string, time: string): string {
  return `shopledger-${date}-${time.replace(/:/g, '')}.db`;
}

/**
 * Writes a consistent copy of the open database. `VACUUM INTO` is safe while the app is running
 * and while a bill is being saved: it copies a single committed snapshot. The copy is written
 * under a temporary name, checked, and only then given its real name, so a half-written file is
 * never mistaken for a backup.
 */
export function createBackup(db: Db, dir: string, date: string, time: string): BackupFile {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) {
    throw new ValidationError('The backup could not be named. Please check the date and time.');
  }
  mkdirSync(dir, { recursive: true });
  const name = backupFileName(date, time);
  const finalPath = join(dir, name);
  const tempPath = `${finalPath}.partial`;
  rmSync(tempPath, { force: true });
  db.prepare('VACUUM INTO ?').run(tempPath);
  const check = checkBackupFile(tempPath);
  if (!check.ok) {
    rmSync(tempPath, { force: true });
    throw new ValidationError(`The backup could not be completed. ${check.message}`);
  }
  renameSync(tempPath, finalPath);
  return { name, path: finalPath, date, bytes: statSync(finalPath).size };
}

const REQUIRED_TABLES = [
  'schema_version',
  'setting',
  'user',
  'account',
  'account_group',
  'item',
  'voucher',
  'voucher_item',
  'journal_line',
  'stock_movement',
  'financial_year',
  'audit_log',
];

export interface BackupCheck {
  ok: boolean;
  /** Plain-language reason when not ok. */
  message: string;
  /** Number of vouchers in the file, for showing "this backup holds 1,234 bills". */
  vouchers: number;
}

/** Opens a file read-only and checks that it is an undamaged ShopLedger database. */
export function checkBackupFile(path: string): BackupCheck {
  if (!existsSync(path)) {
    return { ok: false, message: 'That file could not be found.', vouchers: 0 };
  }
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const report = db
      .prepare('PRAGMA integrity_check')
      .all()
      .map((row) => String(Object.values(row)[0]));
    if (report.length !== 1 || report[0] !== 'ok') {
      return { ok: false, message: 'The file is damaged.', vouchers: 0 };
    }
    const present = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => String(r['name'])),
    );
    if (!REQUIRED_TABLES.every((t) => present.has(t))) {
      return { ok: false, message: 'The file is not a ShopLedger backup.', vouchers: 0 };
    }
    const version = Number(
      db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_version').get()?.['v'],
    );
    if (version > LATEST_SCHEMA_VERSION) {
      return {
        ok: false,
        message:
          'It was made by a newer version of ShopLedger than the one on this computer. Please install the newer version first.',
        vouchers: 0,
      };
    }
    const vouchers = Number(db.prepare('SELECT COUNT(*) AS n FROM voucher').get()?.['n'] ?? 0);
    return { ok: true, message: '', vouchers };
  } catch {
    return {
      ok: false,
      message: 'The file could not be read as a ShopLedger backup.',
      vouchers: 0,
    };
  } finally {
    db?.close();
  }
}

export function listBackups(dir: string): BackupFile[] {
  if (!existsSync(dir)) return [];
  const files: BackupFile[] = [];
  for (const name of readdirSync(dir)) {
    const m = NAME.exec(name);
    if (!m) continue;
    const path = join(dir, name);
    files.push({ name, path, date: `${m[1]}-${m[2]}-${m[3]}`, bytes: statSync(path).size });
  }
  return files.sort((a, b) => (a.name < b.name ? 1 : -1)); // newest first
}

/**
 * Retention: the newest backup of each of the last 30 days that have one, plus the newest backup
 * of each of the last 12 months that have one. Everything else is deleted. At least the newest
 * backup always stays. Returns the names removed.
 */
export function pruneBackups(dir: string): string[] {
  const files = listBackups(dir);
  const keep = new Set<string>();
  const days = new Set<string>();
  const months = new Set<string>();
  for (const f of files) {
    if (days.size < 30 && !days.has(f.date)) {
      days.add(f.date);
      keep.add(f.name);
    }
    const month = f.date.slice(0, 7);
    if (months.size < 12 && !months.has(month)) {
      months.add(month);
      keep.add(f.name);
    }
  }
  const removed: string[] = [];
  for (const f of files) {
    if (keep.has(f.name)) continue;
    rmSync(f.path, { force: true });
    removed.push(f.name);
  }
  return removed;
}

/** Copies a backup to a second place (a removable drive). Returns false when that place is not there. */
export function copyBackupTo(file: BackupFile, dir: string): boolean {
  try {
    if (!existsSync(dirname(dir)) && !existsSync(dir)) return false;
    mkdirSync(dir, { recursive: true });
    const target = join(dir, file.name);
    copyFileSync(file.path, `${target}.partial`);
    renameSync(`${target}.partial`, target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Replaces the shop database file with a backup. The caller must have closed the database first.
 * The backup is checked before anything is touched, and the file being replaced is kept beside
 * it as `<name>.before-restore` so a wrong choice can be undone.
 */
export function restoreDatabaseFile(backupPath: string, dbPath: string): { kept: string | null } {
  const check = checkBackupFile(backupPath);
  if (!check.ok) {
    throw new ValidationError(`This backup cannot be used. ${check.message} Nothing was changed.`);
  }
  let kept: string | null = null;
  if (existsSync(dbPath)) {
    // never overwrite an earlier safety copy: two wrong restores in a row must not lose the original
    let n = 0;
    do {
      kept = `${dbPath}.before-restore${n === 0 ? '' : `-${n}`}`;
      n += 1;
    } while (existsSync(kept));
    copyFileSync(dbPath, kept);
  }
  const staged = `${dbPath}.restoring`;
  copyFileSync(backupPath, staged);
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  renameSync(staged, dbPath);
  return { kept };
}

/** A backup older than two days (or none at all) is worth a reminder on the home screen. */
export function backupReminder(lastAt: string | undefined, today: string): string | null {
  if (!lastAt) {
    return 'No backup of your data has been made yet. The owner should open Settings and press "Back up now".';
  }
  const days = Math.floor(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${lastAt.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );
  return days > 2
    ? `The last backup was ${days} days ago. The owner should open Settings and press "Back up now".`
    : null;
}
