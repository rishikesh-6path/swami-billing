import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('a customer opens on a summary page with the balance, late amount and recent bills', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.getByRole('button', { name: /^Customers/ }).click();
    await page.getByLabel('Find a customer').fill('ayap');
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
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: /Finolex/ })).toBeVisible();
    await expect(page.getByText('You owe').first()).toBeVisible();
  } finally {
    await shop.close();
  }
});
