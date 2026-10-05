import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('the owner sees what sold and what it earned, and saves it as a spreadsheet', async () => {
  const shop = await launch({ demo: true, exportDir: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.keyboard.press('R');
    await page.getByRole('button', { name: /What Sold/ }).click();
    await expect(page.getByRole('heading', { name: 'What Sold' })).toBeVisible();
    await page.getByLabel('Period').selectOption('thisYear');
    await expect(page.getByRole('columnheader', { name: 'Profit' })).toBeVisible();
    await expect(page.getByRole('row', { name: /GI Clamp 1\/2 inch/ })).toBeVisible();
    await page.keyboard.press('Control+E');
    await expect(page.getByText(/^Saved to /)).toBeVisible();
    const file = readdirSync(shop.exportPath).find((f) => f.startsWith('itemSales'));
    const csv = readFileSync(join(shop.exportPath, file ?? ''), 'utf8');
    expect(csv.split('\n')[0]).toContain('Margin %');
    expect(csv).toMatch(/\nTotal,/);
  } finally {
    await shop.close();
  }
});

test('staff do not see the profit report', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page, 'Staff', '1111');
    await page.keyboard.press('R');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await expect(page.getByRole('button', { name: /What Sold/ })).toHaveCount(0);
  } finally {
    await shop.close();
  }
});
