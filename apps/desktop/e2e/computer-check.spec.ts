import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('the owner checks this computer: test page, backup read back, books', async () => {
  const shop = await launch({ demo: true, exportDir: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.keyboard.press('Alt+7'); // locking, limits and support
    await page.getByLabel('Test page paper').selectOption('thermal');
    await page.getByRole('button', { name: 'Check this computer' }).click();

    const results = page.getByRole('list', { name: 'Computer check results' });
    await expect(results.getByText('Books: OK')).toBeVisible({ timeout: 20_000 });
    await expect(results.getByText('Printer: OK')).toBeVisible();
    // with no pen drive chosen the backup step says what to do
    await expect(results.getByText('Backup: Problem')).toBeVisible();
    await expect(results.getByText(/No second copy is set up/)).toBeVisible();
    await expect(page.getByText('Not everything passed.')).toBeVisible();
    const printed = readdirSync(shop.exportPath).find((f) => f.startsWith('printed-'));
    const html = readFileSync(join(shop.exportPath, printed ?? ''), 'utf8');
    expect(html).toContain('PRINTER TEST PAGE');
    expect(html).toContain('80mm');

    // choose a second copy, then everything passes
    await page.keyboard.press('Alt+6');
    await page.getByRole('button', { name: 'Choose a drive for a second copy' }).click();
    await expect(page.getByRole('button', { name: 'Change second copy' })).toBeVisible();
    await page.keyboard.press('Alt+7');
    await page.getByRole('button', { name: 'Check this computer' }).click();
    await expect(page.getByText('All three checks passed.')).toBeVisible({ timeout: 20_000 });
    await expect(results.getByText(/it and the second copy were checked/)).toBeVisible();
  } finally {
    await shop.close();
  }
});
