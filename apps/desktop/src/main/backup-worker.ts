import { join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import {
  checkBackupFile,
  copyBackupTo,
  createBackupFromPath,
  describeBackupError,
  pruneBackups,
} from '@shopledger/core';

export interface BackupJob {
  dbPath: string;
  folder: string;
  copyFolder: string | null;
  date: string;
  time: string;
  /** Also open the files just written, as a restore would ("Check this computer"). */
  readBack?: boolean;
}

/** Whether a backup file opened as a restore would open it, and how many bills it holds. */
export type ReadBack = { ok: boolean; vouchers: number };

export type BackupJobResult =
  | {
      ok: true;
      name: string;
      copied: boolean | null;
      readBack?: { main: ReadBack; copy: ReadBack | null };
    }
  | { ok: false; message: string; detail?: string };

/**
 * Runs in a background thread: copies the database, tidies old backups and copies to the second
 * drive, so billing carries on without a pause while this happens.
 */
function run(job: BackupJob): BackupJobResult {
  try {
    const file = createBackupFromPath(job.dbPath, job.folder, job.date, job.time);
    pruneBackups(job.folder);
    let copied: boolean | null = null;
    if (job.copyFolder) {
      copied = copyBackupTo(file, job.copyFolder);
      if (copied) pruneBackups(job.copyFolder);
    }
    if (!job.readBack) return { ok: true, name: file.name, copied };
    // checked here, off the main thread: a large file on a pen drive takes a while
    const check = (path: string): ReadBack => {
      const c = checkBackupFile(path);
      return { ok: c.ok, vouchers: c.vouchers };
    };
    return {
      ok: true,
      name: file.name,
      copied,
      readBack: {
        main: check(file.path),
        copy: copied && job.copyFolder ? check(join(job.copyFolder, file.name)) : null,
      },
    };
  } catch (error) {
    // the raw system text is never shown to shop staff
    return {
      ok: false,
      message: describeBackupError(error),
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

parentPort?.postMessage(run(workerData as BackupJob));
