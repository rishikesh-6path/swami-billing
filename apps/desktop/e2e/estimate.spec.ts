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
    expect(
      readFileSync(join(shop.exportPath, pdf ?? ''))
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');

    // nothing was saved: the bill is still there and is saved as a normal bill now
    await expect(page.getByLabel('Quantity, row 1')).toHaveValue('4');
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Bill number/)).toBeVisible();
  } finally {
    await shop.close();
  }
});
