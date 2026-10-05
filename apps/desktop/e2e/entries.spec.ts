import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('a receipt raises cash in hand and lowers what the customer owes', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('₹1,45,941.00')).toBeVisible(); // cash in hand

    await page.keyboard.press('F6');
    await expect(page.getByRole('heading', { name: 'New Receipt' })).toBeVisible();
    await expect(page.getByLabel('Received from')).toBeFocused();
    await page.keyboard.type('ayap');
    await expect(page.getByRole('option', { name: /Ayappan/ }).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Owes you ₹11,794\.00/)).toBeVisible();
    await expect(page.getByLabel('Amount received')).toBeFocused();
    await page.keyboard.type('500');
    await page.keyboard.press('Enter'); // note
    await page.keyboard.press('Enter'); // save
    await expect(page.getByText(/Saved\. Receipt number \d+, ₹500\.00/)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText('₹1,46,441.00')).toBeVisible();

    await page.keyboard.press('F8');
    await page.getByLabel('Customer').fill('ayap');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Owes you ₹11,294\.00/)).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('a payment cannot be saved without who it is for or an amount', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('F5');
    await expect(page.getByRole('heading', { name: 'New Payment' })).toBeVisible();
    await page.keyboard.press('F2');
    await expect(page.getByText('Please choose who the money is paid to.')).toBeVisible();
    await page.getByLabel('Paid to').fill('finolex');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/You owe ₹[\d,]+\.\d\d/)).toBeVisible();
    await page.keyboard.press('F2');
    await expect(page.getByText('Please enter the amount.')).toBeVisible();
    await page.getByLabel('Amount paid').fill('2000');
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Payment number \d+, ₹2,000\.00/)).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('a journal entry offers the balancing amount and refuses unequal totals', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('F7');
    await expect(page.getByRole('heading', { name: 'New Journal Entry' })).toBeVisible();
    await expect(page.getByLabel('Account, line 1')).toBeFocused();

    await page.keyboard.type('Discount');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Debit, line 1')).toBeFocused();
    await page.keyboard.type('100');
    await page.keyboard.press('Enter'); // credit
    await page.keyboard.press('Enter'); // next line
    await expect(page.getByLabel('Account, line 2')).toBeFocused();
    await page.keyboard.type('ayap');
    await expect(page.getByRole('option', { name: /Ayappan/ }).first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Credit, line 2')).toHaveValue('100.00'); // offered automatically
    await expect(page.getByTestId('total-dr')).toHaveText('100.00');
    await expect(page.getByTestId('total-cr')).toHaveText('100.00');
    await expect(page.getByText('Debit and credit are equal.')).toBeVisible();

    await page.getByLabel('Credit, line 2').fill('90');
    await page.keyboard.press('F2');
    await expect(
      page.getByText(/debit and credit totals are not equal \(difference ₹10\.00\)/),
    ).toBeVisible();
    await page.getByLabel('Credit, line 2').fill('100');
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Entry number \d+/)).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('a stock count corrects the books to the quantity counted', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.getByRole('button', { name: /Stock Count/ }).click();
    await expect(page.getByRole('heading', { name: 'Physical Stock Count' })).toBeVisible();
    await page.keyboard.type('1500');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Counted, line 1')).toBeFocused();
    await page.keyboard.type('150');
    await expect(page.getByRole('cell', { name: /^-?\d+(\.\d+)?$/ }).last()).toBeVisible();
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Number \d+/)).toBeVisible();
  } finally {
    await shop.close();
  }
});
