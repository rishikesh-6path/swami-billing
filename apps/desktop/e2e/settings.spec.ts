import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('the owner changes shop details and adds a person who can then sign in', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.getByRole('button', { name: /Settings/ }).click();
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await page.getByLabel('Shop name').fill('Swami Hardware');
    await page.keyboard.press('F2');
    await expect(page.getByText('Shop details saved.')).toBeVisible();

    await page.keyboard.press('Alt+3');
    await expect(page.getByRole('heading', { name: 'Add a person' })).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('Ravi');
    await page.getByLabel('PIN (4 to 6 digits)').fill('2931');
    await page.getByRole('button', { name: 'Add person' }).click();
    await expect(page.getByText('Person added.')).toBeVisible();
    await expect(page.getByRole('row', { name: /Ravi/ })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: 'Swami Hardware' })).toBeVisible();
    await page.keyboard.press('U');
    await signIn(page, 'Ravi', '2931');
    await expect(page.getByText('Sales today')).toBeVisible();
    await expect(page.getByRole('button', { name: /Settings/ })).toHaveCount(0);
  } finally {
    await shop.close();
  }
});

test('the owner closes a day and can open it again', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.getByRole('button', { name: /Settings/ }).click();
    await page.keyboard.press('Alt+5');
    await page.getByRole('button', { name: 'Close the day' }).click();
    await expect(page.getByText('Day closed.')).toBeVisible();
    await expect(page.getByText(/Days up to 15-10-2026 are closed/)).toBeVisible();
    await page.getByRole('button', { name: 'Reopen all days' }).click();
    await expect(page.getByText('No day has been closed yet.')).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('a backup can be made, listed and restored', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.getByRole('button', { name: /Settings/ }).click();
    await page.keyboard.press('Alt+6');
    await expect(page.getByText('No backup has been made yet.')).toBeVisible();
    await page.getByRole('button', { name: 'Back up now' }).click();
    await expect(page.getByText('Backup saved.')).toBeVisible();
    await expect(page.getByText(/Last backup: 15-10-2026/)).toBeVisible();
    const folder = (await page.getByTestId('backup-folder').textContent()) ?? '';
    expect(existsSync(folder)).toBe(true);
    expect(readdirSync(folder).filter((n) => n.endsWith('.db'))).toHaveLength(1);

    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Go back to this backup?' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/This backup holds \d+ bills/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await page.getByRole('button', { name: 'Yes, restore it' }).click();
    await expect(page.getByText(/Your data has been restored/)).toBeVisible();
    // the safety copy of the old data was added to the folder before the swap
    expect(
      readdirSync(join(folder)).filter((n) => n.endsWith('.db')).length,
    ).toBeGreaterThanOrEqual(1);
  } finally {
    await shop.close().catch(() => undefined);
  }
});

test('standard notes edited in Settings are the ones offered on a bill', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.getByRole('button', { name: /Settings/ }).click();
    await page.keyboard.press('Alt+4');
    await expect(page.getByLabel('Notes (one on each line)')).toHaveValue(/Being goods sold/);
    await page.getByLabel('Notes (one on each line)').fill('Site delivery\nPay by Friday');
    await page.keyboard.press('F2');
    await expect(page.getByText('Standard notes saved.')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('F8');
    await expect(page.getByLabel('Customer')).toBeFocused();
    await page.keyboard.press('F4');
    const dialog = page.getByRole('dialog', { name: 'Standard notes' });
    await expect(dialog.getByRole('button', { name: 'Pay by Friday' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Being goods sold' })).toHaveCount(0);
  } finally {
    await shop.close();
  }
});
