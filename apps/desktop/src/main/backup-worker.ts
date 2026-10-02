import { parentPort, workerData } from 'node:worker_threads';
import { copyBackupTo, createBackupFromPath, pruneBackups } from '@shopledger/core';

export interface BackupJob {
  dbPath: string;
  folder: string;
  copyFolder: string | null;
  date: string;
  time: string;
}

export type BackupJobResult =
  { ok: true; name: string; copied: boolean | null } | { ok: false; message: string };

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
    return { ok: true, name: file.name, copied };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

parentPort?.postMessage(run(workerData as BackupJob));
