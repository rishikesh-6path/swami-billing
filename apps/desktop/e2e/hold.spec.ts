import { expect, test, type Page } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

async function startCashBill(page: Page): Promise<void> {
  await page.keyboard.press('F8');
  await expect(page.getByLabel('Customer')).toBeFocused();
  await page.keyboard.press('Enter'); // Cash
  await expect(page.getByLabel('Item, row 1')).toBeFocused();
}

async function addItem(page: Page, code: string, qty: string): Promise<void> {
  await page.keyboard.type(code);
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Quantity, row 1')).toBeFocused();
  await page.keyboard.type(qty);
}

test('a bill is set aside while another customer is served, then brought back', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await startCashBill(page);
    await addItem(page, '1500', '3');
    await page.keyboard.press('Alt+H');
    await expect(page.getByText(/The bill is set aside/)).toBeVisible();
    await expect(page.getByLabel('Item, row 1')).toHaveValue('');

    // serve the next customer completely
    await page.keyboard.press('Enter'); // Cash
    await expect(page.getByLabel('Item, row 1')).toBeFocused();
    await addItem(page, '1501', '1');
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Bill number/)).toBeVisible();

    // the first bill comes back with its lines
    await page.keyboard.press('Alt+R');
    await expect(page.getByRole('dialog', { name: 'Bills set aside' })).toBeVisible();
    await page.getByRole('button', { name: /Cash sale - 1 item/ }).click();
    await expect(page.getByText(/The set-aside bill is back/)).toBeVisible();
    await expect(page.getByLabel('Item, row 1')).toHaveValue('GI Clamp 1/2 inch');
    await expect(page.getByLabel('Quantity, row 1')).toHaveValue('3');
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Bill number/)).toBeVisible();

    // nothing is left set aside
    await page.keyboard.press('Alt+R');
    await expect(page.getByText('There are no bills set aside here.')).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('the home screen reminds about a set-aside bill, and a saved bill can be copied', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await startCashBill(page);
    await addItem(page, '1500', '2');
    await page.keyboard.press('Alt+H');
    await expect(page.getByText(/The bill is set aside/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('One bill is set aside.')).toBeVisible();

    // make a bill and copy it with one change
    await startCashBill(page);
    await addItem(page, '1501', '1');
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Bill number/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('D');
    await expect(page.getByRole('heading', { name: 'Find a Bill' })).toBeVisible();
    await page.getByLabel('Period').selectOption('today');
    await page.getByLabel('Kind').selectOption('sales');
    await page.getByLabel('Words to look for').fill('');
    await page.getByLabel('Words to look for').press('Enter');
    await expect(page.getByRole('heading', { name: /^Sales \d+/ })).toBeVisible();
    await page.keyboard.press('Alt+N');
    await expect(page.getByRole('heading', { name: 'New Sale' })).toBeVisible();
    await expect(page.getByLabel('Quantity, row 1')).toHaveValue('1');
    await page.getByLabel('Quantity, row 1').fill('4');
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Bill number/)).toBeVisible();
  } finally {
    await shop.close();
  }
});
