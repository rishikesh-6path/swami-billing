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
  options: { demo?: boolean; today?: string; exportDir?: boolean } = {},
): Promise<Launched> {
  const dir = mkdtempSync(join(tmpdir(), 'shopledger-e2e-'));
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
    exportPath: join(dir, 'exports'),
    close: async () => {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Signs in as a demo user. */
export async function signIn(page: Page, name = 'Owner', pin = '1234'): Promise<void> {
  await page.getByRole('radio', { name }).click();
  await page.getByLabel('Your PIN').fill(pin);
  await page.keyboard.press('Enter');
}
