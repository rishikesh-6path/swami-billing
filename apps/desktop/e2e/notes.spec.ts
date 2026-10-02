import { expect, test } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

test('the owner makes a credit note against a sale and it can be found and printed', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();

    // a credit sale to a registered customer
    await page.keyboard.press('F8');
    await expect(page.getByLabel('Customer')).toBeFocused();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('ayap');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Item, row 1')).toBeFocused();
    await page.keyboard.type('1500');
    await page.keyboard.press('Enter');
    await page.keyboard.type('4'); // 4 x 45.00 = 180.00 + 18% = 212.40, rounded to 212.00
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Bill number \d+, total ₹212\.00/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Sales today')).toBeVisible();

    // the credit note: 20.00 off, before GST
    await page.getByRole('button', { name: /Credit Note/ }).click();
    await expect(page.getByRole('heading', { name: 'New Credit Note' })).toBeVisible();
    await expect(page.getByLabel('Customer')).toBeFocused();
    await page.keyboard.type('ayap');
    await page.keyboard.press('Enter');
    const bill = page.getByLabel('Bill being corrected');
    await expect(bill).toBeFocused();
    await bill.selectOption({ index: 1 }); // the newest bill
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Reason')).toBeFocused();
    await page.keyboard.type('Rate difference agreed');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Item, row 1')).toBeFocused();
    await page.keyboard.type('1500');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Amount, row 1')).toBeFocused();
    await page.keyboard.type('20');
    await expect(page.getByTestId('bill-total')).toHaveText('24.00'); // 20.00 + 3.60 GST, rounded
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Credit Note number \d+, total ₹24\.00/)).toBeVisible();

    // it is found among the bills and prints as a credit note
    await expect(page.getByText('Sales today')).toBeVisible();
    await page.keyboard.press('D');
    await page.getByLabel('Kind').selectOption('credit_note');
    await page.getByLabel('Period').selectOption('thisYear');
    await page.getByLabel('Words to look for').press('Enter');
    await expect(page.getByRole('heading', { name: /^Credit Note \d+/ })).toBeVisible();
    await page.keyboard.press('Control+P');
    const frame = page.frameLocator('iframe[title="Bill preview"]');
    await expect(frame.getByText('CREDIT NOTE').first()).toBeVisible();
    await expect(frame.getByText(/Against bill/)).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('staff do not see the credit note and debit note tiles', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page, 'Staff', '1111');
    await expect(page.getByText('Sales today')).toBeVisible();
    await expect(page.getByRole('button', { name: /Credit Note/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Debit Note/ })).toHaveCount(0);
  } finally {
    await shop.close();
  }
});

test('changing the date on a note does not throw the cursor back to the customer', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.getByRole('button', { name: /Credit Note/ }).click();
    await page.keyboard.type('ayap');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Bill being corrected')).toBeFocused();
    await page.getByLabel('Date').fill('14-10-2026');
    await page.keyboard.press('Tab'); // leaves the date; the screen reloads its numbers
    await expect(page.getByLabel('Bill being corrected')).toBeFocused();
    await expect(page.getByLabel('Customer')).not.toBeFocused();
  } finally {
    await shop.close();
  }
});
