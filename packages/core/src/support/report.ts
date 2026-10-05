import { checkBooks } from './check.ts';
import { statfsSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Db } from '../db/connection.ts';
import { LATEST_SCHEMA_VERSION, currentSchemaVersion } from '../db/migrations.ts';
import { booksLockedThrough, dayClosedThrough } from '../books/control.ts';
import { getSetting } from '../settings.ts';
import { readLogTail } from './log.ts';

function count(db: Db, sql: string): number {
  try {
    return Number(db.prepare(sql).get()?.['n'] ?? 0);
  } catch {
    return -1;
  }
}

/**
 * A plain-text summary a support person can read to understand the state of a shop PC without
 * seeing the shop's business: versions, sizes, counts, whether the data file is healthy, free
 * disk space, backup times and the recent log. It never includes names, amounts, bills or PINs.
 */
export function buildSupportReport(
  db: Db,
  info: { appVersion: string; dbPath: string; logDir: string; platform: string; now: string },
): string {
  const lines: string[] = [];
  const add = (label: string, value: string | number) => lines.push(`${label}: ${value}`);

  lines.push('ShopLedger support information', '');
  add('Made at', info.now);
  add('Program version', info.appVersion);
  add('Computer', info.platform);
  add(
    'Data version',
    `${currentSchemaVersion(db)} (this program expects ${LATEST_SCHEMA_VERSION})`,
  );

  try {
    add('Data file size (MB)', (statSync(info.dbPath).size / 1_000_000).toFixed(1));
  } catch {
    add('Data file size (MB)', 'not readable');
  }
  try {
    const fs = statfsSync(info.dbPath);
    add('Free disk space (GB)', ((fs.bavail * fs.bsize) / 1_000_000_000).toFixed(1));
  } catch {
    add('Free disk space (GB)', 'unknown');
  }

  // a second, read-only look at the file, so a damaged file is reported rather than assumed fine
  const integrity = ((): string => {
    try {
      const check = new DatabaseSync(info.dbPath, { readOnly: true });
      try {
        return check
          .prepare('PRAGMA integrity_check')
          .all()
          .map((r) => String(Object.values(r)[0]))
          .join('; ')
          .slice(0, 300);
      } finally {
        check.close();
      }
    } catch (error) {
      return `could not be checked (${error instanceof Error ? error.name : 'error'})`;
    }
  })();
  add('Data file check', integrity);
  // only which checks passed: the bill numbers in the examples stay out of the support file
  const health = (() => {
    try {
      return checkBooks(db)
        .checks.map((c) => `${c.title}: ${c.ok ? 'ok' : 'PROBLEM'}`)
        .join('; ');
    } catch {
      return 'could not be run';
    }
  })();
  add('Book checks', health);

  lines.push('', 'Counts');
  add('  Bills and entries', count(db, 'SELECT COUNT(*) AS n FROM voucher'));
  add('  Cancelled', count(db, "SELECT COUNT(*) AS n FROM voucher WHERE status = 'cancelled'"));
  add('  Items', count(db, 'SELECT COUNT(*) AS n FROM item'));
  add('  Customers and suppliers', count(db, 'SELECT COUNT(*) AS n FROM account'));
  add('  People who sign in', count(db, 'SELECT COUNT(*) AS n FROM user WHERE is_active = 1'));
  add('  Financial years', count(db, 'SELECT COUNT(*) AS n FROM financial_year'));

  lines.push('', 'Settings that matter');
  add('  Days closed through', dayClosedThrough(db) ?? 'none');
  add('  Books locked through', booksLockedThrough(db) ?? 'not locked');
  add('  Last backup', getSetting(db, 'backup.last_at') || 'never');
  add('  Backup problem noted', getSetting(db, 'backup.failed_at') ? 'yes' : 'no');
  add('  Second copy problem noted', getSetting(db, 'backup.copy_failed_at') ? 'yes' : 'no');

  lines.push('', 'Recent log (newest last)');
  const tail = readLogTail(info.logDir, 200);
  lines.push(...(tail.length > 0 ? tail : ['(nothing logged)']));
  return `${lines.join('\n')}\n`;
}
