import { join } from 'node:path';
import {
  copyBackupTo,
  createBackup,
  getSetting,
  listBackups,
  pruneBackups,
  setSetting,
  type Db,
} from '@shopledger/core';
import type { BackupStatus } from '../ipc/contract.ts';

const FOLDER = 'backup.folder';
const COPY_FOLDER = 'backup.copy_folder';
const LAST_AT = 'backup.last_at';
const LAST_SLOT = 'backup.last_slot';
const COPY_FAILED = 'backup.copy_failed_at';
const FAILED = 'backup.failed_at';

/** The times of day (shop time) at which a backup is made while the app is open. */
export const BACKUP_TIMES = ['14:00', '20:00'] as const;

export interface BackupPlace {
  /** Where backups go when the owner has not chosen a folder. */
  defaultFolder: string;
}

export function backupFolder(db: Db, place: BackupPlace): string {
  return getSetting(db, FOLDER) || place.defaultFolder;
}

export function backupStatus(db: Db, place: BackupPlace): BackupStatus {
  const folder = backupFolder(db, place);
  return {
    folder,
    copyFolder: getSetting(db, COPY_FOLDER) || null,
    lastAt: getSetting(db, LAST_AT) || null,
    backups: listBackups(folder).slice(0, 30),
  };
}

export function setBackupFolder(db: Db, which: 'main' | 'copy', folder: string | null): void {
  setSetting(db, which === 'main' ? FOLDER : COPY_FOLDER, folder ?? '');
}

/** `date` is YYYY-MM-DD and `time` is HH:MM:SS, both in shop time. */
export function runBackup(
  db: Db,
  place: BackupPlace,
  date: string,
  time: string,
  slot?: string,
): { copied: boolean | null; name: string } {
  const folder = backupFolder(db, place);
  const file = createBackup(db, folder, date, time);
  pruneBackups(folder);
  const copyFolder = getSetting(db, COPY_FOLDER);
  let copied: boolean | null = null;
  if (copyFolder) {
    copied = copyBackupTo(file, copyFolder);
    if (copied) pruneBackups(copyFolder);
  }
  setSetting(db, LAST_AT, `${date} ${time.slice(0, 5)}`);
  setSetting(db, FAILED, '');
  // remembered so the home screen can say the second copy did not happen
  setSetting(db, COPY_FAILED, copied === false ? date : '');
  if (slot) setSetting(db, LAST_SLOT, slot);
  return { copied, name: file.name };
}

/** The scheduled slot that is due now and has not been done yet, e.g. "2026-10-15 14:00". */
export function dueSlot(db: Db, date: string, time: string): string | undefined {
  const last = getSetting(db, LAST_SLOT) ?? '';
  const due = BACKUP_TIMES.filter((t) => time >= t)
    .map((t) => `${date} ${t}`)
    .filter((slot) => slot > last);
  return due.at(-1);
}

export const defaultBackupFolder = (userData: string) => join(userData, 'backups');

/** A scheduled backup that failed: remembered (and not retried every minute) so the owner is told. */
export function markBackupFailed(db: Db, date: string, slot?: string): void {
  setSetting(db, FAILED, date);
  if (slot) setSetting(db, LAST_SLOT, slot);
}

/** Plain-language warning about the last backup attempts, or null when all is well. */
export function backupProblem(db: Db): string | null {
  const failed = getSetting(db, FAILED);
  if (failed) {
    return 'The last automatic backup did not work. Please check there is free space and press "Back up now" in Settings.';
  }
  const copyFailed = getSetting(db, COPY_FAILED);
  if (copyFailed) {
    return 'The second copy of your backup (the pen drive) did not work. Please plug the drive in and press "Back up now" in Settings.';
  }
  return null;
}
