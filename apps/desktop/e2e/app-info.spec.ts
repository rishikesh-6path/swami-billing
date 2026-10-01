import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const migrationsDir = join(import.meta.dirname, '../../../packages/core/migrations');
const migrationCount = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).length;

test('shows the data file location and version, then closes cleanly', async () => {
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
      SHOPLEDGER_USER_DATA: join(dir, 'userData'),
      SHOPLEDGER_DB_PATH: dbPath,
    },
  });
  try {
    const window = await app.firstWindow();
    await expect(window.getByText('Your shop data is ready')).toBeVisible();

    await window.getByText('About this computer').click();
    await expect(window.getByTestId('schema-version')).toHaveText(String(migrationCount));
    await expect(window.getByTestId('db-path')).toHaveText(dbPath);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
