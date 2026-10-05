import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('the screen locks when idle, a wrong PIN is refused, and the bill is still there after unlocking', async () => {
  const shop = await launch({ demo: true, lockSeconds: 3 });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('F8');
    await expect(page.getByLabel('Customer')).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.type('1500');
    await page.keyboard.press('Enter');
    await page.keyboard.type('7');

    // nothing is touched for a few seconds
    const lock = page.getByRole('dialog', { name: 'Screen locked' });
    await expect(lock).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Your PIN')).toBeFocused();
    // keys do not reach the bill behind the lock
    await page.keyboard.press('F2');
    await expect(lock).toBeVisible();
    // and the program itself refuses work while locked, not only the screen
    const ask = () =>
      page.evaluate(async () => {
        const api = (
          globalThis as unknown as {
            shopledger: { invoke: (c: string, r: unknown) => Promise<unknown> };
          }
        ).shopledger;
        try {
          await api.invoke('voucher.list', {});
          return 'ok';
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      });
    await expect.poll(ask).toMatch(/locked/);

    await page.keyboard.type('9999');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/not right/)).toBeVisible();
    await page.getByLabel('Your PIN').fill('1234');
    await page.keyboard.press('Enter');
    await expect(lock).toHaveCount(0);
    await expect(page.getByLabel('Quantity, row 1')).toHaveValue('7');
    expect(await ask()).toBe('ok');
  } finally {
    await shop.close();
  }
});

test('support information is saved without any business details, and the lock time can be changed', async () => {
  const shop = await launch({ demo: true, exportDir: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.getByRole('button', { name: /Settings/ }).click();
    await page.keyboard.press('Alt+7');
    await page.getByLabel('Minutes before locking').fill('15');
    await page.keyboard.press('F2');
    await expect(page.getByText('The screen locks after 15 minutes.')).toBeVisible();

    await page.getByRole('button', { name: 'Save information for support' }).click();
    await expect(page.getByText(/Send this file to whoever supports you/)).toBeVisible();
    const file = readdirSync(shop.exportPath).find((f) => f.startsWith('shopledger-support-'));
    expect(file).toBeTruthy();
    const text = readFileSync(join(shop.exportPath, file ?? ''), 'utf8');
    expect(text).toContain('Program version:');
    expect(text).toContain('started, version'); // the log is being written
    expect(text).toMatch(/Data file check: ok/);
    for (const secret of ['Ayappan', 'Finolex', 'Demo Hardware', '1234', 'GI Clamp']) {
      expect(text).not.toContain(secret);
    }
  } finally {
    await shop.close();
  }
});

test('staff cannot reach the lock and support settings', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page, 'Staff', '1111');
    await expect(page.getByText('Sales today')).toBeVisible();
    await expect(page.getByRole('button', { name: /Settings/ })).toHaveCount(0);
  } finally {
    await shop.close();
  }
});
