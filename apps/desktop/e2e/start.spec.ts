import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('a new shop is set up once, then lands on the home screen', async () => {
  const shop = await launch();
  try {
    const { page } = shop;
    await expect(page.getByRole('heading', { name: 'Welcome to ShopLedger' })).toBeVisible();

    await page.getByLabel('Shop name').fill('Swami Hardware');
    await page.getByLabel('Address').fill('12 Main Road, Kuttalam');
    await page.getByLabel('Your name').fill('Tony');
    await page.getByLabel('Choose a PIN').fill('4821');
    await page.getByLabel('Type the PIN again').fill('4822');
    await page.getByRole('button', { name: 'Finish setup' }).click();
    await expect(page.getByText('The two PINs are not the same')).toBeVisible();

    await page.getByLabel('Type the PIN again').fill('4821');
    await page.getByRole('button', { name: 'Finish setup' }).click();
    await expect(page.getByRole('heading', { name: 'Swami Hardware' })).toBeVisible();
    await expect(page.getByText('Signed in as Tony')).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('staff sign in with their name and PIN; a wrong PIN gets a plain message', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await expect(page.getByRole('radio', { name: 'Owner' })).toBeVisible();

    await signIn(page, 'Staff', '9999');
    await expect(page.getByText('The name or PIN is not right. Please try again.')).toBeVisible();

    await signIn(page, 'Staff', '1111');
    await expect(page.getByRole('heading', { name: 'Demo Hardware & Electricals' })).toBeVisible();
    await expect(page.getByText('Sales today')).toBeVisible();
    await expect(page.getByText('Signed in as Staff')).toBeVisible();

    // switch user with the keyboard
    await page.keyboard.press('U');
    await expect(page.getByText('Who is signing in?')).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('help shows the data file details under About this computer', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('F1');
    await page.getByText('About this computer').click();
    await expect(page.getByTestId('db-path')).toHaveText(shop.dbPath);
    await expect(page.getByTestId('schema-version')).toHaveText(/^\d+$/);
    await page.keyboard.press('Escape');
    await expect(page.getByText('Keys you can use')).toBeHidden();
  } finally {
    await shop.close();
  }
});
