import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('a customer opens on a summary page with the balance, late amount and recent bills', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.getByRole('button', { name: /^Customers/ }).click();
    await page.getByLabel('Find a customer').fill('ayap');
    await expect(page.getByRole('row', { name: /Ayappan/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /Ayappan/ })).toBeVisible();
    await expect(page.getByText('Owes you').first()).toBeVisible();
    await expect(page.getByTestId('party-balance')).toContainText('₹');
    await expect(page.getByText(/^Late \(past 30 credit days\)/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Latest bills' })).toBeVisible();

    // the full ledger is one key away, and Esc comes back to the summary
    await page.keyboard.press('L');
    await expect(page.getByRole('heading', { name: /Account Ledger/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: /Ayappan/ })).toBeVisible();

    // F2 changes the details
    await page.keyboard.press('F2');
    await expect(page.getByLabel('Name')).toHaveValue(/Ayappan/);
  } finally {
    await shop.close();
  }
});

test('a supplier summary says what you owe', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.getByRole('button', { name: /^Suppliers/ }).click();
    await page.getByLabel('Find a supplier').fill('finolex');
    await expect(page.getByRole('row', { name: /Finolex/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /Finolex/ })).toBeVisible();
    await expect(page.getByText('You owe').first()).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('a sale and a receipt can start from the customer page with the customer already chosen', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.getByRole('button', { name: /^Customers/ }).click();
    await page.getByLabel('Find a customer').fill('ayap');
    await expect(page.getByRole('row', { name: /Ayappan/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /Ayappan/ })).toBeVisible();

    await page.keyboard.press('F8');
    await expect(page.getByLabel('Customer')).toHaveValue(/Ayappan/);
    await expect(page.getByLabel('Item, row 1')).toBeFocused();
    // the price this customer paid last time is offered for an item they bought before
    await page.keyboard.type('1500');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Quantity, row 1')).toBeFocused();
    await page.keyboard.type('2');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Yes, throw it away' }).click();

    await expect(page.getByRole('heading', { name: /Ayappan/ })).toBeVisible();
    await page.keyboard.press('F6');
    await expect(page.getByLabel('Received from')).toHaveValue(/Ayappan/);
    await expect(page.getByLabel(/^Amount/)).toBeFocused();
    await page.keyboard.type('100');
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Receipt number \d+/)).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('the last price a customer paid is offered and F3 uses it', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    // sell item 1500 to Ayappan at a special price
    await page.keyboard.press('F8');
    await expect(page.getByLabel('Customer')).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('ayap');
    await page.keyboard.press('Enter');
    await page.keyboard.type('1500');
    await page.keyboard.press('Enter');
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    await page.keyboard.type('41'); // list price is 45.00
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Bill number/)).toBeVisible();

    // next time: the same customer and item show the 41.00 and F3 puts it in
    await page.keyboard.press('Control+A');
    await page.keyboard.type('ayap');
    await page.keyboard.press('Enter');
    await page.keyboard.type('1500');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Last time 41\.00/)).toBeVisible();
    await page.keyboard.type('1');
    await page.keyboard.press('Enter'); // on the price box now
    await page.keyboard.press('F3');
    await expect(page.getByLabel('Price, row 1')).toHaveValue('41.00');
  } finally {
    await shop.close();
  }
});
