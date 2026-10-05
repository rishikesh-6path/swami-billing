import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('the owner checks the books and is told all is well', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.keyboard.press('Alt+7'); // locking, limits and support
    await page.getByRole('button', { name: 'Check my books now' }).click();
    await expect(page.getByText('All is well. Your books add up.')).toBeVisible();
    await expect(page.locator('.check-bad')).toHaveCount(0);
    await expect(page.locator('.check-ok')).toHaveCount(8);
  } finally {
    await shop.close();
  }
});
