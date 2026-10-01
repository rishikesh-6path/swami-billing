import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/connection.ts';
import { loadMigrationsFromDir, migrate } from '../../src/db/migrations.ts';
import { seedDemoShop } from '../../src/demo/seed.ts';
import { MIGRATIONS_DIR } from '../helpers/db.ts';
import { tempDir } from '../helpers/tmp.ts';

/**
 * Process-kill test for the "power cut while saving a bill" requirement: a child process posts
 * bills in a loop and is killed with SIGKILL (no chance to clean up) while one is mid-save. The
 * database must reopen cleanly and every bill that exists must be complete and balanced.
 * A real power cut on the shop PC is still a manual check (docs/OWNER_RUNBOOK.md).
 */
describe('killing the app while it is saving bills', () => {
  it.each([1, 2, 3])(
    'leaves only whole, balanced bills (round %i)',
    async (round) => {
      const path = join(tempDir(), 'shop.db');
      const setup = openDatabase(path);
      migrate(setup, loadMigrationsFromDir(MIGRATIONS_DIR));
      seedDemoShop(setup, { today: '2026-10-15' });
      const before = Number(setup.prepare('SELECT COUNT(*) AS n FROM voucher').get()?.['n']);
      setup.close();

      const child = spawn(
        process.execPath,
        [
          '--experimental-transform-types',
          '--disable-warning=ExperimentalWarning',
          join(import.meta.dirname, '../helpers/crash-child.ts'),
          path,
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] },
      );
      const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
      let posted = 0;
      await new Promise<void>((resolve, reject) => {
        const wanted = 15 * round;
        child.stdout.on('data', (chunk: Buffer) => {
          posted += chunk
            .toString()
            .split('\n')
            .filter((l) => l.startsWith('posted')).length;
          if (posted >= wanted) resolve();
        });
        child.on('error', reject);
        child.on('exit', () => resolve());
      });
      child.kill('SIGKILL');
      await exited;
      expect(posted).toBeGreaterThan(0);

      const db = openDatabase(path); // runs integrity_check
      const total = Number(db.prepare('SELECT COUNT(*) AS n FROM voucher').get()?.['n']);
      expect(total).toBeGreaterThanOrEqual(before + posted);

      // every voucher is balanced, has its audit row, and numbers have no gaps
      const unbalanced = db
        .prepare(
          `SELECT v.id FROM voucher v JOIN journal_line j ON j.voucher_id = v.id
         GROUP BY v.id HAVING SUM(j.dr_paise) <> SUM(j.cr_paise)`,
        )
        .all();
      expect(unbalanced).toEqual([]);
      const noJournal = db
        .prepare(
          `SELECT v.id FROM voucher v WHERE v.voucher_type = 'sales'
         AND NOT EXISTS (SELECT 1 FROM journal_line j WHERE j.voucher_id = v.id)`,
        )
        .all();
      expect(noJournal).toEqual([]);
      const noAudit = db
        .prepare(
          `SELECT v.id FROM voucher v WHERE NOT EXISTS
         (SELECT 1 FROM audit_log a WHERE a.table_name = 'voucher' AND a.row_id = v.id)`,
        )
        .all();
      expect(noAudit).toEqual([]);
      const gaps = db
        .prepare(
          `SELECT series_id, fy_id, COUNT(*) AS n, MAX(number) AS top FROM voucher
         GROUP BY series_id, fy_id HAVING COUNT(*) <> MAX(number)`,
        )
        .all();
      expect(gaps).toEqual([]);
      const counters = db
        .prepare(
          `SELECT c.series_id FROM voucher_counter c
         WHERE c.last_no <> (SELECT COALESCE(MAX(number), 0) FROM voucher v
                                 WHERE v.series_id = c.series_id AND v.fy_id = c.fy_id)`,
        )
        .all();
      expect(counters).toEqual([]);
      db.close();
    },
    60_000,
  );
});
