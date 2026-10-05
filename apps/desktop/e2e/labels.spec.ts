import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('labels are made from a purchase bill and saved as a PDF, by keyboard', async () => {
  const shop = await launch({ demo: true, exportDir: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.keyboard.press('D');
    await expect(page.getByRole('heading', { name: 'Find a Bill' })).toBeVisible();
    await page.getByLabel('Period').selectOption('thisYear');
    await page.getByLabel('Kind').selectOption('purchase');
    await page.getByLabel('Words to look for').fill('');
    await page.getByLabel('Words to look for').press('Enter');
    await expect(page.getByRole('heading', { name: /^Purchase / })).toBeVisible();
    await page.keyboard.press('Alt+L');
    await expect(page.getByRole('heading', { name: 'Print Labels' })).toBeVisible();
    await expect(page.getByText(/\d+ labels? on \d+ sheets?\./)).toBeVisible();

    // add one more item by its code and ask for 3 labels
    await page.getByLabel('Add an item').focus();
    await page.keyboard.type('1500');
    await page.keyboard.press('Enter');
    const count = page.getByLabel(/Labels for GI Clamp 1\/2 inch/);
    await expect(count).toBeFocused();
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Add an item')).toBeFocused();

    await page.keyboard.press('Control+S');
    await expect(page.getByText(/^Saved to /)).toBeVisible();
    const pdf = readdirSync(shop.exportPath).find((f) => f === 'labels.pdf');
    expect(pdf).toBe('labels.pdf');
    expect(readFileSync(join(shop.exportPath, 'labels.pdf')).subarray(0, 5).toString()).toBe(
      '%PDF-',
    );

    await page.keyboard.press('F2'); // print: in tests the page is kept as a file
    await expect(page.getByText('The labels were sent to the printer.')).toBeVisible();
  } finally {
    await shop.close();
  }
});
