import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('the owner raises all prices by 10 per cent after seeing the new prices', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('I'); // items
    await expect(page.getByRole('heading', { name: 'Items' })).toBeVisible();
    await expect(page.getByRole('row', { name: /GI Clamp 1\/2 inch.*45\.00/ })).toBeVisible();
    await page.keyboard.press('Alt+P');
    await expect(page.getByRole('heading', { name: 'Change Prices' })).toBeVisible();

    await page.getByLabel('By how many per cent').fill('10');
    await page.keyboard.press('F2');
    await expect(page.getByText(/items will change/)).toBeVisible();
    // 45.00 + 10% = 49.50, rounded to the nearest rupee = 50.00
    await expect(
      page.getByRole('row', { name: /GI Clamp 1\/2 inch.*45\.00.*50\.00/ }),
    ).toBeVisible();

    // changing a choice hides the list, so a stale list can never be saved
    await page.getByLabel('By how many per cent').fill('20');
    await expect(page.getByText(/items will change/)).toHaveCount(0);
    await page.getByLabel('By how many per cent').fill('10');
    await page.keyboard.press('F2');
    await expect(page.getByText(/items will change/)).toBeVisible();
    await page.keyboard.press('F2');
    await page.getByRole('button', { name: 'Yes, change the prices' }).click();
    await expect(page.getByText(/Done\. The prices of \d+ items were changed\./)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Items' })).toBeVisible();
    await expect(page.getByRole('row', { name: /GI Clamp 1\/2 inch.*50\.00/ })).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('staff cannot change prices', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page, 'Staff', '1111');
    await page.keyboard.press('I');
    await expect(page.getByRole('heading', { name: 'Items' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Change prices/ })).toHaveCount(0);
    const answer = await page.evaluate(async () => {
      const api = (
        globalThis as unknown as {
          shopledger: { invoke: (c: string, r: unknown) => Promise<unknown> };
        }
      ).shopledger;
      try {
        await api.invoke('price.apply', { percentBp: 1000 });
        return 'ok';
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    });
    expect(answer).not.toBe('ok');
  } finally {
    await shop.close();
  }
});

test('the stock report can be turned into a counting sheet', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.keyboard.press('S');
    await expect(page.getByRole('heading', { name: 'Stock Report' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Value' })).toBeVisible();
    await page.getByLabel(/Counting sheet/).check();
    await expect(page.getByRole('columnheader', { name: 'Counted' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Value' })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /GI Clamp 1\/2 inch/ })).toBeVisible();
  } finally {
    await shop.close();
  }
});
