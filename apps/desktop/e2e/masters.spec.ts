import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('an item is created with the keyboard only and can be sold straight away', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();

    await page.keyboard.press('F2');
    await expect(page.getByRole('heading', { name: 'Add Item' })).toBeVisible();
    await expect(page.getByLabel('Item name')).toBeFocused();
    for (const value of ['Test Elbow 2 inch', 'TE2']) {
      await page.keyboard.type(value);
      await page.keyboard.press('Enter');
    }
    await page.keyboard.press('Enter'); // group
    await page.keyboard.press('Enter'); // unit
    for (const value of ['39174000', '18', '35', '45', '40', '22', '10']) {
      await page.keyboard.type(value);
      await page.keyboard.press('Enter'); // the last Enter saves
    }
    await expect(page.getByText('Saved "Test Elbow 2 inch".')).toBeVisible();

    // it can be sold at once: code, quantity 2 -> 70.00 + 18% GST = 82.60, rounded to 83.00
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('F8');
    await expect(page.getByLabel('Customer')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Item, row 1')).toBeFocused();
    await page.keyboard.type('TE2');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Quantity, row 1')).toBeFocused();
    await expect(page.getByLabel('Price, row 1')).toHaveValue('35.00');
    await page.keyboard.type('2');
    await expect(page.getByTestId('bill-total')).toHaveText('83.00');
  } finally {
    await shop.close();
  }
});

test('item mistakes are explained in plain words', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('F2');
    await page.getByLabel('Item name').fill('Bad Item');
    await page.getByLabel('HSN code').fill('12');
    await page.keyboard.press('F2');
    await expect(page.getByText('The HSN code should be 4 to 8 digits.')).toBeVisible();

    await page.getByLabel('HSN code').fill('39174000');
    await page.getByLabel('Item name').fill('GI Clamp 1/2 inch');
    await page.keyboard.press('F2');
    await expect(page.getByText('An item named "GI Clamp 1/2 inch" already exists.')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog', { name: 'Leave without saving?' })).toBeVisible();
    await page.keyboard.press('Y');
    await expect(page.getByText('Sales today')).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('the item list finds items by name or code and opens one to change', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.getByRole('button', { name: /^Items/ }).click();
    await expect(page.getByRole('heading', { name: 'Items' })).toBeVisible();
    await page.keyboard.type('8450');
    await expect(page.getByRole('row', { name: /PVC Pipe 1 inch/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /GI Clamp/ })).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Change Item' })).toBeVisible();
    await expect(page.getByLabel('Item name')).toHaveValue('PVC Pipe 1 inch');
    await page.getByLabel('GST rate (%)').fill('12');
    await expect(page.getByText('bills already made keep their old rate')).toBeVisible();
    await page.keyboard.press('F2');
    await expect(page.getByText('Saved "PVC Pipe 1 inch".')).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('a new customer can be added and billed', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('F3');
    await expect(page.getByRole('heading', { name: 'Add customer' })).toBeVisible();
    await page.getByLabel('Name').fill('Raja Hardware');
    await page.getByLabel('Phone number').fill('98400 77777');
    await page.getByLabel('GST number (if they have one)').fill('33AAAAA0000A1Z0');
    await page.keyboard.press('F2');
    await expect(page.getByText(/GST number "33AAAAA0000A1Z0" does not look right/)).toBeVisible();
    await page.getByLabel('GST number (if they have one)').fill('');
    await page.keyboard.press('F2');
    await expect(page.getByText('Saved "Raja Hardware".')).toBeVisible();

    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('F8');
    await page.getByLabel('Customer').fill('raja');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Item, row 1')).toBeFocused();
  } finally {
    await shop.close();
  }
});
