import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('a bill can be previewed and saved as a PDF', async () => {
  const shop = await launch({ demo: true, exportDir: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();

    await page.keyboard.press('D');
    await expect(page.getByRole('heading', { name: 'Find a Bill' })).toBeVisible();
    await page.getByLabel('Kind').selectOption('sales');
    await page.getByLabel('Words to look for').press('Enter');
    await expect(page.getByRole('heading', { name: /^Sales \d+/ })).toBeVisible();

    await page.keyboard.press('Control+P');
    const dialog = page.getByRole('dialog', { name: 'Print preview' });
    await expect(dialog).toBeVisible();
    const frame = page.frameLocator('iframe[title="Bill preview"]');
    await expect(frame.getByText('Demo Hardware & Electricals').first()).toBeVisible();
    await expect(frame.getByText('TAX INVOICE').first()).toBeVisible();

    await page.getByLabel('Paper').selectOption('thermal');
    await expect(frame.getByText('Demo Hardware & Electricals').first()).toBeVisible();

    await page.getByRole('button', { name: 'Save as PDF' }).click();
    await expect(page.getByText(/^Saved to /)).toBeVisible();
    const files = readdirSync(shop.exportPath).filter((f) => f.endsWith('.pdf'));
    expect(files).toHaveLength(1);
    const head = readFileSync(join(shop.exportPath, files[0] ?? ''))
      .subarray(0, 4)
      .toString();
    expect(head).toBe('%PDF');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  } finally {
    await shop.close();
  }
});
