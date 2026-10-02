import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

/**
 * Smoke test for the packaged app (the folder made by `pnpm package:dir`, or the Windows
 * build). Skipped unless SHOPLEDGER_PACKAGED_EXE points at the executable. It proves the
 * migrations ship inside the package and the app starts without any node_modules.
 */
const exe = process.env['SHOPLEDGER_PACKAGED_EXE'];

test.skip(!exe, 'set SHOPLEDGER_PACKAGED_EXE to test a packaged build');

test('the packaged app opens, sets up its database and shows the welcome screen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopledger-pkg-'));
  const runningAsRoot = process.platform === 'linux' && process.getuid?.() === 0;
  const app = await electron.launch({
    executablePath: exe!,
    args: runningAsRoot ? ['--no-sandbox'] : [],
    env: {
      ...process.env,
      SHOPLEDGER_E2E: '1',
      SHOPLEDGER_USER_DATA: join(dir, 'userData'),
      SHOPLEDGER_NO_RELAUNCH: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Welcome to ShopLedger' })).toBeVisible();
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the packaged app can make a backup (the background worker is inside the package)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopledger-pkg-'));
  const runningAsRoot = process.platform === 'linux' && process.getuid?.() === 0;
  const app = await electron.launch({
    executablePath: exe!,
    args: runningAsRoot ? ['--no-sandbox'] : [],
    env: {
      ...process.env,
      SHOPLEDGER_E2E: '1',
      SHOPLEDGER_DEMO: '1',
      SHOPLEDGER_USER_DATA: join(dir, 'userData'),
      SHOPLEDGER_NO_RELAUNCH: '1',
    },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('radio', { name: 'Owner' }).click();
    await page.getByLabel('Your PIN').fill('1234');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /Settings/ }).click();
    await page.keyboard.press('Alt+6');
    await page.getByRole('button', { name: 'Back up now' }).click();
    await expect(page.getByText('Backup saved.')).toBeVisible();
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
