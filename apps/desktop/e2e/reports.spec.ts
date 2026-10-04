import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('a receipt shows up in the customer ledger with the right running balance', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('F6');
    await expect(page.getByLabel('Received from')).toBeFocused();
    await page.keyboard.type('ayap');
    await expect(page.getByRole('option', { name: /Ayappan/ }).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Amount received')).toBeFocused();
    await page.keyboard.type('500');
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Receipt number/)).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('L'); // account ledger
    await expect(page.getByRole('heading', { name: 'Account Ledger' })).toBeVisible();
    await page.keyboard.type('ayap');
    await expect(page.getByRole('option', { name: /Ayappan/ }).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await page.getByLabel('Period').selectOption('thisYear');
    await expect(page.getByText(/Opening balance:\s*2,365\.00 Dr/)).toBeVisible();
    const lastRow = page.getByRole('row').filter({ hasText: 'Receipt' }).last();
    await expect(lastRow).toContainText('500.00');
    // the closing balance in the footer equals the balance the sale screen showed before the receipt, less 500
    await expect(page.getByRole('row').last()).toContainText('11,294.00 Dr');
  } finally {
    await shop.close();
  }
});

test('stock report lists items and can show only those running low', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('S');
    await expect(page.getByRole('heading', { name: 'Stock Report' })).toBeVisible();
    await expect(page.getByText(/Total stock value:/)).toBeVisible();
    await expect(page.getByRole('row', { name: /GI Clamp 1\/2 inch/ })).toBeVisible();
    const all = await page.getByRole('row').count();
    await page.getByLabel('Only items running low or below zero').check();
    await expect.poll(async () => page.getByRole('row').count()).toBeLessThan(all);
  } finally {
    await shop.close();
  }
});

test('staff see the daily reports only; the owner also sees accounts and GST', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page, 'Staff', '1111');
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('R');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Day Book/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /GST Summary/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Profit and Loss/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('V'); // owner-only key does nothing for staff
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('U');
    await signIn(page, 'Owner', '1234');
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('R');
    await expect(page.getByRole('button', { name: /GST Summary/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Profit and Loss/ })).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('the owner reads the GST summary and saves GSTR-1 as spreadsheet files', async () => {
  const shop = await launch({ demo: true, exportDir: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('V');
    await expect(page.getByRole('heading', { name: 'GST Summary' })).toBeVisible();
    await page.getByLabel('Period').selectOption('thisYear');
    await expect(
      page.getByText(/GST to pay for this period|GST credit to carry forward/),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sales (tax you collected)' })).toBeVisible();

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape'); // back to home from the hub if we went through it
    await page.keyboard.press('R');
    await page.getByRole('button', { name: /GSTR-1 Sales Return/ }).click();
    await page.getByLabel('Period').selectOption('thisYear');
    await expect(page.getByRole('heading', { name: /HSN summary/ })).toBeVisible();
    await page.keyboard.press('Control+E');
    await expect(page.getByText(/^Saved to /)).toBeVisible();
    // each export goes into its own folder named for the period
    const [folderName, ...others] = readdirSync(shop.exportPath);
    expect(others).toEqual([]);
    expect(folderName).toMatch(/^gstr1/i);
    const folder = join(shop.exportPath, folderName ?? '');
    const files = readdirSync(folder).sort();
    expect(files).toEqual([
      'b2b.csv',
      'b2cl.csv',
      'b2cs.csv',
      'cdnr.csv',
      'cdnur.csv',
      'docs.csv',
      'exemp.csv',
      'hsn.csv',
    ]);
    expect(readFileSync(join(folder, 'b2b.csv'), 'utf8')).toContain('GSTIN/UIN of Recipient');
    expect(readFileSync(join(folder, 'hsn.csv'), 'utf8')).toContain('73079990');
  } finally {
    await shop.close();
  }
});

test('profit and balance sheet agree with each other for the demo shop', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('B');
    await expect(page.getByRole('heading', { name: 'Balance Sheet' })).toBeVisible();
    const totals = page.locator('.bs-total');
    await expect(totals).toHaveCount(2);
    const [left, right] = await totals.allTextContents();
    expect(left).toBe(right);
    await page.keyboard.press('Escape');
    await page.keyboard.press('T');
    await expect(page.getByRole('heading', { name: 'Trial Balance' })).toBeVisible();
    await expect(page.getByText(/do not balance/)).toHaveCount(0);
  } finally {
    await shop.close();
  }
});

test('the purchases file for the CA has the supplier invoices, and the items to order list opens', async () => {
  const shop = await launch({ demo: true, exportDir: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.keyboard.press('R');
    await page.getByRole('button', { name: /Items to Order/ }).click();
    await expect(page.getByRole('heading', { name: 'Items to Order' })).toBeVisible();
    await expect(page.getByText('Last bought from')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: /Purchases for the CA/ }).click();
    await expect(page.getByRole('heading', { name: 'Purchases for the CA' })).toBeVisible();
    await page.getByLabel('Period').selectOption('thisYear');
    await expect(page.getByRole('columnheader', { name: 'Invoice', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: /^(FIN|HAV|ANC)\/\d+$/ }).first()).toBeVisible();
    await page.keyboard.press('Control+E');
    await expect(page.getByText(/^Saved to /)).toBeVisible();
    const file = readdirSync(shop.exportPath).find((f) => f.startsWith('purchasesForCa'));
    expect(file).toBeTruthy();
    const csv = readFileSync(join(shop.exportPath, file ?? ''), 'utf8');
    expect(csv.split('\n')[0]).toContain('GSTIN of supplier');
    expect(csv).toMatch(/(FIN|HAV|ANC)\/\d+/);
  } finally {
    await shop.close();
  }
});
