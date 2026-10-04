import { rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('on 1 April bills can be made at once, and the old year stays open', async () => {
  // the shop is set up and used in March, then opened again on 1 April
  const march = await launch({ demo: true, today: '2027-03-31', keepData: true });
  await signIn(march.page);
  await expect(march.page.getByText('Sales today')).toBeVisible();
  await march.close();
  const shop = await launch({ today: '2027-04-01', dataDir: march.dataDir });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('F8');
    await expect(page.getByLabel('Customer')).toBeFocused();
    await page.keyboard.press('Enter'); // Cash
    await expect(page.getByLabel('Item, row 1')).toBeFocused();
    await page.keyboard.type('1500');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Quantity, row 1')).toBeFocused();
    await page.keyboard.type('1');
    await page.keyboard.press('F2');
    // the first bill of the new year is number 1
    await expect(page.getByText(/Saved\. Bill number 1,/)).toBeVisible();
    await page.keyboard.press('Escape');

    // both years are open; the old one can be closed and opened again
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.keyboard.press('Alt+5'); // closing days and years
    const oldYear = page.getByRole('row', { name: /2026-27/ });
    await expect(oldYear).toContainText('Open');
    await expect(page.getByRole('row', { name: /2027-28/ })).toContainText('Open');
    await oldYear.getByRole('button', { name: 'Close this year' }).click();
    await page.getByRole('button', { name: 'Yes, close the year' }).click();
    await expect(oldYear).toContainText('Closed');
    await oldYear.getByRole('button', { name: 'Open this year again' }).click();
    await page.getByRole('button', { name: 'Yes, open it again' }).click();
    await expect(oldYear).toContainText('Open');
  } finally {
    await shop.close();
  }
});

test('a computer clock that is badly wrong does not stop the app or create years', async () => {
  const setUp = await launch({ demo: true, keepData: true });
  await setUp.close();
  for (const today of ['2000-01-01', '2035-06-01']) {
    const shop = await launch({ today, dataDir: setUp.dataDir, keepData: true });
    try {
      await signIn(shop.page);
      await expect(shop.page.getByText('Sales today')).toBeVisible();
      const labels = await shop.page.evaluate(async () => {
        const api = (
          globalThis as unknown as {
            shopledger: { invoke: (c: string, r: unknown) => Promise<unknown> };
          }
        ).shopledger;
        const settings = (await api.invoke('settings.get', {})) as { years: { label: string }[] };
        return settings.years.map((y) => y.label);
      });
      expect(labels).toEqual(['2026-27']);
    } finally {
      await shop.close();
    }
  }
  rmSync(setUp.dataDir, { recursive: true, force: true });
});
