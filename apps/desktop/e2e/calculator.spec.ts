import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('F10 opens a calculator from the bill screen and Esc returns to the bill', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.keyboard.press('F8');
    await expect(page.getByLabel('Customer')).toBeFocused();
    await page.keyboard.press('F10');
    const dialog = page.getByRole('dialog', { name: 'Calculator' });
    await expect(dialog).toBeVisible();
    await page.keyboard.type('450*12+30');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('calc-answer')).toHaveText('= 5430');
    await page.keyboard.type('+');
    await page.keyboard.press('Enter');
    await expect(page.getByText('The sum is not finished.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'New Sale' })).toBeVisible();
  } finally {
    await shop.close();
  }
});
