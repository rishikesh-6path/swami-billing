import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('an estimate is saved as a PDF and the bill stays on screen to be saved later', async () => {
  const shop = await launch({ demo: true, exportDir: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('F8');
    await expect(page.getByLabel('Customer')).toBeFocused();
    await page.keyboard.press('Enter'); // Cash
    await expect(page.getByLabel('Item, row 1')).toBeFocused();
    await page.keyboard.type('1500');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Quantity, row 1')).toBeFocused();
    // a row that is not finished is pointed out, as saving would, instead of being left out
    await page.keyboard.press('Alt+E');
    await expect(page.getByText('Row 1: please enter the quantity.')).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Estimate' })).toHaveCount(0);
    await expect(page.getByLabel('Quantity, row 1')).toBeFocused();
    await page.keyboard.type('4');
    await expect(page.getByTestId('bill-total')).not.toHaveText('0.00');

    await page.keyboard.press('Alt+E');
    const dialog = page.getByRole('dialog', { name: 'Estimate' });
    await expect(dialog).toBeVisible();
    await expect(
      page.frameLocator('iframe[title="Estimate preview"]').getByText('ESTIMATE', { exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Control+S');
    await expect(page.getByText(/The bill is still on the screen/)).toBeVisible();
    const pdf = readdirSync(shop.exportPath).find((f) => f.startsWith('estimate-'));
    expect(pdf).toMatch(/^estimate-cash-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(
      readFileSync(join(shop.exportPath, pdf ?? ''))
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');

    // nothing was saved: the bill is still there, the cursor is back where it was, and the bill
    // is saved as a normal bill now
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Quantity, row 1')).toHaveValue('4');
    await expect(page.getByLabel('Quantity, row 1')).toBeFocused();
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Bill number/)).toBeVisible();
  } finally {
    await shop.close();
  }
});
