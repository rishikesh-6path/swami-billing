import { expect, test, type Page } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

/** Makes a cash sale of one item with the keyboard and returns to the home screen. */
async function quickSale(page: Page, code: string, qty: string): Promise<void> {
  await page.keyboard.press('F8');
  await expect(page.getByLabel('Customer')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Item, row 1')).toBeFocused();
  await page.keyboard.type(code);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Quantity, row 1')).toBeFocused();
  await page.keyboard.type(qty);
  await page.keyboard.press('F2');
  await expect(page.getByText(/Saved\. Bill number/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Sales today')).toBeVisible();
}

test('a bill is cancelled with a reason, the totals drop, and the owner can see who did it', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('₹15,176.00')).toBeVisible();
    await quickSale(page, '1500', '1'); // 45.00 + 18% = 53.10, rounded to 53.00
    await expect(page.getByText('₹15,229.00')).toBeVisible();
    await expect(page.getByText('5 bills')).toBeVisible();

    await page.keyboard.press('D');
    await expect(page.getByRole('heading', { name: 'Find a Bill' })).toBeVisible();
    await page.getByLabel('Period').selectOption('today');
    await page.getByLabel('Kind').selectOption('sales');
    await page.keyboard.press('Control+A');
    await page.getByLabel('Words to look for').fill('');
    await page.getByLabel('Words to look for').press('Enter'); // opens the first (newest) bill
    await expect(page.getByRole('heading', { name: /^Sales \d+/ })).toBeVisible();
    await expect(page.getByText('GI Clamp 1/2 inch')).toBeVisible();

    await page.keyboard.press('Alt+C');
    await expect(page.getByRole('alertdialog', { name: 'Cancel this bill?' })).toBeVisible();
    await page.keyboard.press('Enter'); // no reason yet
    await expect(page.getByText(/Please write a short reason/)).toBeVisible();
    await page.keyboard.type('Wrong customer');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/has been cancelled\./)).toBeVisible();
    await expect(page.getByText('This bill has been cancelled.')).toBeVisible();

    await page.keyboard.press('Escape'); // list
    await page.keyboard.press('Escape'); // home
    await expect(page.getByText('₹15,176.00')).toBeVisible();
    await expect(page.getByText('4 bills')).toBeVisible();

    await page.getByRole('button', { name: /Who Did What/ }).click();
    await expect(page.getByRole('row', { name: /Cancelled.*Wrong customer/ })).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('changing a bill replaces it with a corrected one', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await quickSale(page, '1500', '1'); // 53.00

    await page.keyboard.press('Alt+B'); // find a sale to change
    await expect(page.getByRole('heading', { name: 'Find a Bill' })).toBeVisible();
    await page.getByLabel('Period').selectOption('today');
    await page.getByLabel('Words to look for').press('Enter');
    await expect(page.getByRole('heading', { name: /^Sales \d+/ })).toBeVisible();
    await page.keyboard.press('Alt+B'); // change
    await expect(
      page.getByText('Saving will replace this bill with a corrected one.'),
    ).toBeVisible();
    await expect(page.getByLabel('Quantity, row 1')).toHaveValue('1');
    await page.getByLabel('Quantity, row 1').fill('2');
    await expect(page.getByTestId('bill-total')).toHaveText('106.00');
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Bill number \d+, total ₹106\.00/)).toBeVisible();

    await page.keyboard.press('Escape'); // bill view
    await page.keyboard.press('Escape'); // list
    await page.keyboard.press('Escape'); // home
    await expect(page.getByText('₹15,282.00')).toBeVisible(); // 15,176 + 106; the first bill no longer counts
    await expect(page.getByText('5 bills')).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('staff cannot open the audit log', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page, 'Staff', '1111');
    await expect(page.getByText('Sales today')).toBeVisible();
    await expect(page.getByRole('button', { name: /Who Did What/ })).toHaveCount(0);
  } finally {
    await shop.close();
  }
});
