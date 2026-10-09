import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('the owner moves the label print and makes a test sheet', async () => {
  const shop = await launch({ demo: true, exportDir: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.keyboard.press('Alt+2'); // printing
    await expect(page.getByRole('heading', { name: 'Label sheets' })).toBeVisible();
    await page.getByLabel('Move down (mm)').fill('7');
    await page.getByRole('button', { name: 'Save label settings' }).click();
    await expect(page.getByText(/from -5 to 5/)).toBeVisible();
    await page.getByLabel('Move down (mm)').fill('1.5');
    await page.getByLabel('Move right (mm)').fill('-0.5');
    await page.getByRole('button', { name: 'Save label settings' }).click();
    await expect(page.getByText('Label sheet settings saved.')).toBeVisible();
    await page.getByRole('button', { name: 'Save the test sheet as PDF' }).click();
    await expect(page.getByText(/^Saved to /)).toBeVisible();
    const pdf = readFileSync(join(shop.exportPath, 'label-test-sheet.pdf'));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    const saved = await page.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          shopledger: { invoke: (c: string, r: unknown) => Promise<unknown> };
        }
      ).shopledger;
      return api.invoke('labels.settings', {});
    });
    expect(saved).toEqual({ layout: '3x8', topTenthMm: 15, leftTenthMm: -5 });
  } finally {
    await shop.close();
  }
});
