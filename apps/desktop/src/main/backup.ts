import { join } from 'node:path';
import { ValidationError, getSetting, listBackups, setSetting, type Db } from '@shopledger/core';
import { log } from './log.ts';
import BackupWorker from './backup-worker?nodeWorker';
import type { BackupJob, BackupJobResult } from './backup-worker.ts';
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

/** Backups are made one at a time; this is the last one queued or running. */
let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;

/** True while a backup is running or queued (so a timer need not add another). */
export const backupBusy = (): boolean => waiting > 0;

/** Resolves when every backup started so far has finished, or false after `ms` if one is still going. */
export async function settleBackups(ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  const done = queue.then(
    () => true,
    () => true,
  );
  const outcome = await Promise.race([done, limit]);
  clearTimeout(timer);
  return outcome;
}

/**
 * Makes a backup in a background thread and records the result. `date` is YYYY-MM-DD and `time`
 * is HH:MM:SS, both in shop time. Every caller (the timer, the Back up now button, the app
 * closing) joins one line, so two backups never run at once. Gives up on its own worker after
 * `timeoutMs` (a slow or unplugged drive) with a plain-language message.
 */
export function runBackup(
  db: Db,
  place: BackupPlace,
  dbPath: string,
  date: string,
  time: string,
  slot?: string,
  timeoutMs = 120_000,
): Promise<{ copied: boolean | null; name: string }> {
  waiting += 1;
  const mine = queue.then(
    () => backupOnce(db, place, dbPath, date, time, slot, timeoutMs),
    () => backupOnce(db, place, dbPath, date, time, slot, timeoutMs),
  );
  queue = mine.catch(() => undefined).finally(() => (waiting -= 1));
  return mine;
}

async function backupOnce(
  db: Db,
  place: BackupPlace,
  dbPath: string,
  date: string,
  time: string,
  slot: string | undefined,
  timeoutMs: number,
): Promise<{ copied: boolean | null; name: string }> {
  const job: BackupJob = {
    dbPath,
    folder: backupFolder(db, place),
    copyFolder: getSetting(db, COPY_FOLDER) || null,
    date,
    time,
  };
  const result = await new Promise<BackupJobResult>((resolve) => {
    const worker = BackupWorker({ workerData: job });
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({
        ok: false,
        message:
          'The backup is taking too long. Please check the backup drive is working and try again.',
      });
    }, timeoutMs);
    const finish = (r: BackupJobResult) => {
      clearTimeout(timer);
      resolve(r);
    };
    worker.once('message', finish);
    worker.once('error', (e) => {
      log('error', 'backup worker error', e);
      finish({
        ok: false,
        message: 'The backup could not be completed. An unexpected problem stopped it.',
      });
    });
    worker.once('exit', (code) => {
      if (code !== 0) {
        finish({
          ok: false,
          message: 'The backup could not be completed. It stopped unexpectedly.',
        });
      }
    });
  });
  if (!result.ok) {
    log('warn', `backup did not complete: ${result.detail ?? result.message}`);
    throw new ValidationError(result.message);
  }
  setSetting(db, LAST_AT, `${date} ${time.slice(0, 5)}`);
  setSetting(db, FAILED, '');
  // remembered so the home screen can say the second copy did not happen
  setSetting(db, COPY_FAILED, result.copied === false ? date : '');
  if (slot) setSetting(db, LAST_SLOT, slot);
  return { copied: result.copied, name: result.name };
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
