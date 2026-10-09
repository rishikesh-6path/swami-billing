import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('a customer statement is shown from the customer page and saved as a PDF', async () => {
  const shop = await launch({ demo: true, exportDir: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.getByRole('button', { name: /^Customers/ }).click();
    await page.getByLabel(/Find a customer/).fill('Ayappan');
    await expect(page.getByRole('row', { name: /Ayappan Pipe Kuttalam/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Ayappan Pipe Kuttalam' })).toBeVisible();
    await page.keyboard.press('Control+P');
    const dialog = page.getByRole('dialog', { name: 'Statement of account' });
    await expect(dialog).toBeVisible();
    const preview = page.frameLocator('iframe[title="Statement preview"]');
    await expect(preview.getByText('STATEMENT OF ACCOUNT')).toBeVisible();
    await expect(preview.getByText(/Amount due: ₹/)).toBeVisible();
    await page.keyboard.press('Control+S');
    await expect(page.getByText(/^Saved to /)).toBeVisible();
    const pdf = readdirSync(shop.exportPath).find((f) => f.startsWith('statement-'));
    expect(pdf).toMatch(/^statement-Ayappan-Pipe-Kuttalam-2026-10-15\.pdf$/);
    expect(
      readFileSync(join(shop.exportPath, pdf ?? ''))
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
  } finally {
    await shop.close();
  }
});
