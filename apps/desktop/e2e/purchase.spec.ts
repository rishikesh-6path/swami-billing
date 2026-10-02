import { expect, test, type Page } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

/** Enters one purchase from "Finolex" with the keyboard only. */
async function purchase(page: Page, invoiceNo: string) {
  await page.keyboard.press('F9');
  await expect(page.getByLabel('Supplier', { exact: true })).toBeFocused();
  await page.keyboard.type('finolex');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel("Supplier's invoice no.")).toBeFocused();
  await page.keyboard.type(invoiceNo);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel("Supplier's invoice date")).toBeFocused();
  await page.keyboard.type('10-10-2026');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Item, row 1')).toBeFocused();
  await page.keyboard.type('1500');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Quantity, row 1')).toBeFocused();
  await page.keyboard.type('10');
  await page.keyboard.press('F2');
}

test('a purchase carries the supplier invoice, and the same invoice cannot be entered twice', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();

    await purchase(page, 'FIN/9001');
    await expect(page.getByText(/Saved\. Bill number \d+/)).toBeVisible();

    await purchase(page, 'fin/9001');
    await expect(page.getByText(/already entered as Purchase/)).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Yes|Leave|Discard/ }).click();

    await page.keyboard.press('D');
    await page.getByLabel('Words to look for').fill('FIN/9001');
    await page.getByLabel('Period').selectOption('thisYear');
    await expect(page.getByRole('row', { name: /Purchase/ })).toHaveCount(1);
  } finally {
    await shop.close();
  }
});

test('a purchase from a registered supplier cannot be saved without the supplier invoice', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.keyboard.press('F9');
    await page.keyboard.type('finolex');
    await page.keyboard.press('Enter');
    await page.getByLabel("Supplier's invoice no.").press('Enter');
    await page.getByLabel("Supplier's invoice date").press('Enter');
    await page.keyboard.type('1500');
    await page.keyboard.press('Enter');
    await page.keyboard.type('2');
    await page.keyboard.press('F2');
    await expect(page.getByText(/invoice number and date/)).toBeVisible();
  } finally {
    await shop.close();
  }
});
