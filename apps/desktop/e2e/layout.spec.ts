import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

/** Screenshots go here when SHOPLEDGER_SHOTS is set (for people checking the look by eye). */
const shots = process.env['SHOPLEDGER_SHOTS'];

/** The page must fit across a 1024 pixel screen: nothing may need sideways scrolling. */
async function fits(page: Page, name: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = (
      globalThis as unknown as {
        document: { documentElement: { scrollWidth: number; clientWidth: number } };
      }
    ).document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  if (shots) {
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, `${name}.png`) });
  }
  expect(overflow, `${name} is wider than the screen`).toBeLessThanOrEqual(0);
}

test('every main screen fits a 1024 x 768 screen', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await page.setViewportSize({ width: 1024, height: 768 });
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await fits(page, '01-home');

    // a sale with ten lines
    await page.keyboard.press('F8');
    await expect(page.getByLabel('Customer')).toBeFocused();
    await page.keyboard.press('Enter');
    await fits(page, '02a-sale-empty');
    for (let i = 1; i <= 10; i++) {
      await expect(page.getByLabel(`Item, row ${i}`)).toBeFocused();
      await page.keyboard.type(i % 2 ? '1500' : '1501');
      await page.keyboard.press('Enter');
      await expect(page.getByLabel(`Quantity, row ${i}`)).toBeFocused();
      await page.keyboard.type('1');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
    }
    await expect(page.getByTestId('bill-total')).not.toHaveText('0.00');
    await expect(page.locator('.header-total')).toContainText('₹');
    await expect(page.getByRole('button', { name: /Save \(F2\)/ })).toBeInViewport();
    await fits(page, '02-sale-10-lines');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Yes, throw it away' }).click();

    await page.keyboard.press('F6');
    await expect(page.getByRole('heading', { name: 'New Receipt' })).toBeVisible();
    await fits(page, '03-receipt');
    await page.keyboard.press('Escape');

    await page.keyboard.press('R');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await fits(page, '04-reports');
    await page.keyboard.press('Escape');

    await page.keyboard.press('S');
    await expect(page.getByRole('heading', { name: 'Stock Report' })).toBeVisible();
    await fits(page, '05-stock');
    await page.keyboard.press('Escape');

    await page.keyboard.press('I');
    await expect(page.getByRole('heading', { name: 'Items' })).toBeVisible();
    await fits(page, '06-items');
    await page.keyboard.press('Alt+P');
    await expect(page.getByRole('heading', { name: 'Change Prices' })).toBeVisible();
    await fits(page, '07-change-prices');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('row', { name: /GI Clamp 1\/2 inch/ })).toBeVisible();
    await page.keyboard.press('Alt+L');
    await expect(page.getByRole('heading', { name: 'Print Labels' })).toBeVisible();
    await expect(page.getByText(/1 label on 1 sheet\./)).toBeVisible();
    await fits(page, '08-labels');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Settings' }).click();
    for (let n = 1; n <= 7; n++) {
      await page.keyboard.press(`Alt+${n}`);
      await page.waitForTimeout(150);
      await fits(page, `09-settings-${n}`);
    }
  } finally {
    await shop.close();
  }
});
