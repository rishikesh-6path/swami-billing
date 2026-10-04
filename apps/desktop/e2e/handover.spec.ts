import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('the owner saves everything for the accountant in one folder', async () => {
  const shop = await launch({ demo: true, exportDir: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.keyboard.press('R');
    await expect(
      page.getByRole('heading', { name: 'Data for the accountant (owner)' }),
    ).toBeVisible();
    await page.getByLabel('Period').selectOption('thisYear');
    await page.getByRole('button', { name: 'Save everything for my accountant' }).click();
    await expect(page.getByText(/Give this folder to your accountant/)).toBeVisible();
    const [folderName] = readdirSync(shop.exportPath);
    expect(folderName).toMatch(/^accountant_/);
    const folder = join(shop.exportPath, folderName ?? '');
    expect(readdirSync(folder).sort()).toEqual([
      'Bills and entries.csv',
      'Customers.csv',
      'Items.csv',
      'Ledger lines.csv',
      'Read me.txt',
      'Suppliers.csv',
    ]);
    const bills = readFileSync(join(folder, 'Bills and entries.csv'), 'utf8').trim().split('\n');
    expect(bills[0]).toContain('Supplier');
    expect(bills.length).toBeGreaterThan(5);
    expect(readFileSync(join(folder, 'Items.csv'), 'utf8')).toContain('GI Clamp 1/2 inch');
  } finally {
    await shop.close();
  }
});

test('staff do not see the accountant export', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page, 'Staff', '1111');
    await page.keyboard.press('R');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Data for the accountant/ })).toHaveCount(0);
  } finally {
    await shop.close();
  }
});

test('a report is saved as a PDF file', async () => {
  const shop = await launch({ demo: true, exportDir: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.keyboard.press('R');
    await page.getByRole('button', { name: /GST Summary/ }).click();
    await expect(page.getByRole('heading', { name: 'GST Summary' })).toBeVisible();
    await page.getByLabel('Period').selectOption('thisYear');
    await expect(page.getByRole('heading', { name: 'Sales (tax you collected)' })).toBeVisible();
    await page.keyboard.press('Control+S');
    await expect(page.getByText(/^Saved to /)).toBeVisible();
    const file = readdirSync(shop.exportPath).find((f) => f.endsWith('.pdf'));
    expect(file).toMatch(/^gstSummary_/);
    const path = join(shop.exportPath, file ?? '');
    expect(existsSync(path)).toBe(true);
    expect(statSync(path).size).toBeGreaterThan(1000);
    expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
  } finally {
    await shop.close();
  }
});
