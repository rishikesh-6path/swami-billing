import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('Tab stays inside a dialog and focus returns to the screen when it closes', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.keyboard.press('D');
    await page.getByLabel('Kind').selectOption('sales');
    await page.getByLabel('Words to look for').press('Enter');
    await expect(page.getByRole('heading', { name: /^Sales \d+/ })).toBeVisible();

    await page.keyboard.press('Alt+C');
    const ask = page.getByRole('alertdialog', { name: 'Cancel this bill?' });
    await expect(ask).toBeVisible();
    await expect(page.getByLabel('Why is it being cancelled?')).toBeFocused();
    // twelve Tabs go round the three controls many times; focus never leaves the dialog
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      await expect(ask.locator(':focus')).toHaveCount(1);
    }
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Shift+Tab');
      await expect(ask.locator(':focus')).toHaveCount(1);
    }
    await page.keyboard.press('Escape');
    await expect(ask).toHaveCount(0);
    // the keyboard still works on the page behind it
    await page.keyboard.press('Alt+C');
    await expect(ask).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('the calculator keeps Tab inside too', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.keyboard.press('F10');
    await expect(page.getByRole('dialog', { name: 'Calculator' })).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      await expect(page.getByRole('dialog', { name: 'Calculator' }).locator(':focus')).toHaveCount(
        1,
      );
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Calculator' })).toHaveCount(0);
  } finally {
    await shop.close();
  }
});
