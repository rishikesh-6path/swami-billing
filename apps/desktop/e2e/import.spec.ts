import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('items are added from a spreadsheet and a wrong row is reported, not fatal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shopledger-import-'));
  const file = join(dir, 'items.csv');
  writeFileSync(
    file,
    'Name,Alias,Unit,GST %,Price\nCopper Tape,9101,Roll,18,120\nBad Rate Item,9102,Pcs,abc,10\nSteel Nail 2 inch,9103,Kg,18,90\n',
  );
  process.env['SHOPLEDGER_IMPORT_FILE'] = file;
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.getByRole('button', { name: /Add from a Spreadsheet/ }).click();
    await expect(page.getByRole('heading', { name: 'Add from a Spreadsheet' })).toBeVisible();
    await page.keyboard.press('I');
    await expect(page.getByTestId('import-result')).toHaveText('2 added, 1 skipped.');
    await expect(page.getByRole('row', { name: /3.*not a valid GST rate/ })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('F8');
    await expect(page.getByLabel('Customer')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.type('9101');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Quantity, row 1')).toBeFocused();
  } finally {
    delete process.env['SHOPLEDGER_IMPORT_FILE'];
    await shop.close();
  }
});
