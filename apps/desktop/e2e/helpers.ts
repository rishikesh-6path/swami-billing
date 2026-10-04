import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

export interface Launched {
  app: ElectronApplication;
  page: Page;
  dbPath: string;
  /** Where exports are written when `exportDir` was asked for. */
  exportPath: string;
  close: () => Promise<void>;
}

/**
 * Starts ShopLedger against a fresh temporary database. With `demo`, a sample shop is loaded
 * (Owner PIN 1234, Staff PIN 1111). The date is pinned so results do not depend on the day.
 */
export async function launch(
  options: {
    demo?: boolean;
    today?: string;
    exportDir?: boolean;
    lockSeconds?: number;
    /** Open the data of an earlier launch (made with keepData) instead of a fresh one. */
    dataDir?: string;
    /** Leave the data in place on close, so a later launch can open it on another day. */
    keepData?: boolean;
  } = {},
): Promise<Launched & { dataDir: string }> {
  const dir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'shopledger-e2e-'));
  const dbPath = join(dir, 'shopledger.db');
  const runningAsRoot = process.platform === 'linux' && process.getuid?.() === 0;
  const app = await electron.launch({
    args: [
      join(import.meta.dirname, '../out/main/index.js'),
      ...(runningAsRoot ? ['--no-sandbox'] : []),
    ],
    env: {
      ...process.env,
      SHOPLEDGER_E2E: '1',
      SHOPLEDGER_USER_DATA: join(dir, 'userData'),
      SHOPLEDGER_DB_PATH: dbPath,
      SHOPLEDGER_NO_RELAUNCH: '1',
      SHOPLEDGER_TODAY: options.today ?? '2026-10-15',
      // the screen lock is off in tests unless asked for, so slow steps never get locked out
      SHOPLEDGER_LOCK_SECONDS: String(options.lockSeconds ?? 0),
      ...(options.demo ? { SHOPLEDGER_DEMO: '1' } : {}),
      ...(options.exportDir ? { SHOPLEDGER_EXPORT_DIR: join(dir, 'exports') } : {}),
    },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 });
  return {
    app,
    page,
    dbPath,
    dataDir: dir,
    exportPath: join(dir, 'exports'),
    close: async () => {
      await app.close();
      if (!options.keepData) rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Signs in as a demo user. */
export async function signIn(page: Page, name = 'Owner', pin = '1234'): Promise<void> {
  await page.getByRole('radio', { name }).click();
  await page.getByLabel('Your PIN').fill(pin);
  await page.keyboard.press('Enter');
}
