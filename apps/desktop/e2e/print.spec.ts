import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('a bill can be previewed and saved as a PDF', async () => {
  const shop = await launch({ demo: true, exportDir: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();

    await page.keyboard.press('D');
    await expect(page.getByRole('heading', { name: 'Find a Bill' })).toBeVisible();
    await page.getByLabel('Kind').selectOption('sales');
    await page.getByLabel('Words to look for').press('Enter');
    await expect(page.getByRole('heading', { name: /^Sales \d+/ })).toBeVisible();

    await page.keyboard.press('Control+P');
    const dialog = page.getByRole('dialog', { name: 'Print preview' });
    await expect(dialog).toBeVisible();
    const frame = page.frameLocator('iframe[title="Bill preview"]');
    await expect(frame.getByText('Demo Hardware & Electricals').first()).toBeVisible();
    await expect(frame.getByText('TAX INVOICE').first()).toBeVisible();
    // the preview must be laid out like the printout (the page rules allow the invoice's own styles)
    await expect(frame.locator('.title')).toHaveCSS('text-align', 'center');

    await page.getByLabel('Paper').selectOption('thermal');
    await expect(frame.getByText('Demo Hardware & Electricals').first()).toBeVisible();

    await page.getByRole('button', { name: 'Save as PDF' }).click();
    await expect(page.getByText(/^Saved to /)).toBeVisible();
    const files = readdirSync(shop.exportPath).filter((f) => f.endsWith('.pdf'));
    expect(files).toHaveLength(1);
    const head = readFileSync(join(shop.exportPath, files[0] ?? ''))
      .subarray(0, 4)
      .toString();
    expect(head).toBe('%PDF');

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  } finally {
    await shop.close();
  }
});

test('Enter on a focused button presses that button, not the screen shortcut', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.keyboard.press('D');
    await page.getByLabel('Kind').selectOption('sales');
    await page.getByLabel('Words to look for').press('Enter');
    await expect(page.getByRole('heading', { name: /^Sales \d+/ })).toBeVisible();

    // cancel dialog: Enter on "No, keep it" must keep the bill
    await page.keyboard.press('Alt+C');
    const ask = page.getByRole('alertdialog', { name: 'Cancel this bill?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: /keep/i }).focus();
    await page.keyboard.press('Enter');
    await expect(ask).toHaveCount(0);
    await expect(page.getByText('This bill has been cancelled.')).toHaveCount(0);

    // print dialog: Enter on Close must close it without printing
    await page.keyboard.press('Control+P');
    const dialog = page.getByRole('dialog', { name: 'Print preview' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /Close/ }).focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(/Sent to the printer|not printed/)).toHaveCount(0);
  } finally {
    await shop.close();
  }
});

test('Ctrl+P then Enter prints', async () => {
  const shop = await launch({ demo: true, exportDir: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.keyboard.press('D');
    await page.getByLabel('Kind').selectOption('sales');
    await page.getByLabel('Words to look for').press('Enter');
    await expect(page.getByRole('heading', { name: /^Sales \d+/ })).toBeVisible();
    await page.keyboard.press('Control+P');
    await expect(page.getByRole('button', { name: /^Print \(Enter\)/ })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Sent to the printer.')).toBeVisible();
  } finally {
    await shop.close();
  }
});
