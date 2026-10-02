import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendLog,
  buildSupportReport,
  formatLogLine,
  loadMigrationsFromDir,
  migrate,
  openDatabase,
  readLogTail,
  seedDemoShop,
} from '../src/index.ts';
import { MIGRATIONS_DIR } from './helpers/db.ts';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'support-test-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('log file', () => {
  it('keeps the current log and a few old ones, and never grows without limit', () => {
    for (let i = 0; i < 40; i++)
      appendLog(dir, `line ${i} ${'x'.repeat(90)}`, { maxBytes: 500, keep: 3 });
    const files = readdirSync(dir).sort();
    expect(files).toEqual([
      'shopledger.log',
      'shopledger.log.1',
      'shopledger.log.2',
      'shopledger.log.3',
    ]);
    const newest = readLogTail(dir, 1)[0];
    expect(newest).toContain('line 39');
    expect(readFileSync(join(dir, 'shopledger.log.1'), 'utf8')).toContain('line');
  });

  it('formats one line per event, hides error data, and survives an unwritable folder', () => {
    const line = formatLogLine('error', 'save failed\nwith newline', new Error('boom'));
    expect(line).toMatch(
      /^\d{4}-\d{2}-\d{2}T[\d:.]+Z ERROR save failed with newline \| Error: boom$/,
    );
    writeFileSync(join(dir, 'file'), 'x');
    expect(() => appendLog(join(dir, 'file', 'inside'), 'x')).not.toThrow(); // a file where a folder should be
    expect(readLogTail(join(dir, 'missing'))).toEqual([]);
  });
});

describe('support information', () => {
  it('describes the machine and the data without any names, amounts or PINs', () => {
    const dbPath = join(dir, 'shop.db');
    const db = openDatabase(dbPath);
    migrate(db, loadMigrationsFromDir(MIGRATIONS_DIR));
    seedDemoShop(db, { today: '2026-10-15' });
    appendLog(dir, formatLogLine('error', 'a problem happened'));
    const text = buildSupportReport(db, {
      appVersion: '1.0.0',
      dbPath,
      logDir: dir,
      platform: 'win32 x64',
      now: '2026-10-15T10:00:00.000Z',
    });
    expect(text).toContain('Program version: 1.0.0');
    expect(text).toMatch(/Data file check: ok/);
    expect(text).toMatch(/Bills and entries: \d+/);
    expect(text).toContain('a problem happened');
    expect(text).toMatch(/Free disk space \(GB\): [\d.]+/);
    // nothing about the shop's business or its people
    for (const secret of [
      'Ayappan',
      'Finolex',
      'Demo Hardware',
      'Owner',
      'Staff',
      '1234',
      '1111',
      'GI Clamp',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(existsSync(dbPath)).toBe(true);
    db.close();
  });
});
