import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('closing the app makes a backup in the background and the data stays usable', async () => {
  const shop = await launch({ demo: true });
  const folder = join(dirname(shop.exportPath), 'userData', 'backups');
  try {
    await signIn(shop.page);
    await expect(shop.page.getByText('Sales today')).toBeVisible();
    expect(existsSync(folder)).toBe(false);
    await shop.app.close(); // the closing backup runs before the app really exits
    const files = readdirSync(folder).filter((n) =>
      /^shopledger-\d{4}-\d{2}-\d{2}-\d{6}\.db$/.test(n),
    );
    expect(files).toHaveLength(1);
    expect(readdirSync(folder).some((n) => n.endsWith('.partial'))).toBe(false);
  } finally {
    await shop.close().catch(() => undefined);
  }
});

test('a manual backup works and the missing-backup warning goes away', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.getByRole('button', { name: /Settings/ }).click();
    await page.keyboard.press('Alt+6');
    // a manual backup works and the warning on the home screen goes away
    await page.getByRole('button', { name: 'Back up now' }).click();
    await expect(page.getByText('Backup saved.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Sales today')).toBeVisible();
    await expect(page.getByText(/No backup of your data/)).toHaveCount(0);
  } finally {
    await shop.close();
  }
});
