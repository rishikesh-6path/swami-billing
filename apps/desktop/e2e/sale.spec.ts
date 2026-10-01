import { expect, test, type Page } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

/** Types an item code, waits for the quantity box, then fills quantity and accepts price and discount. */
async function addLine(page: Page, row: number, code: string, qty: string): Promise<void> {
  await page.keyboard.type(code);
  await page.keyboard.press('Enter'); // the code is an exact match, so no list is needed
  await expect(page.getByLabel(`Quantity, row ${row}`)).toBeFocused();
  await page.keyboard.type(qty);
  await page.keyboard.press('Enter'); // -> price (already filled from the item)
  await page.keyboard.press('Enter'); // -> discount
  await page.keyboard.press('Enter'); // -> next row
}

test('a 5-line cash bill is entered and saved with the keyboard only', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await expect(page.getByText('Sales today')).toBeVisible();
    await expect(page.getByText('₹15,176.00')).toBeVisible();

    const started = Date.now();
    await page.keyboard.press('F8');
    await expect(page.getByRole('heading', { name: 'New Sale' })).toBeVisible();
    await expect(page.getByLabel('Customer')).toBeFocused();
    await expect(page.getByLabel('Customer')).toHaveValue('Cash');
    await page.keyboard.press('Enter'); // accept Cash
    await expect(page.getByLabel('Item, row 1')).toBeFocused();

    await addLine(page, 1, '1500', '2');
    await expect(page.getByLabel('Item, row 2')).toBeFocused();
    await addLine(page, 2, '1501', '1');
    await addLine(page, 3, '8460', '5');
    await addLine(page, 4, '8461', '3');
    await addLine(page, 5, 'S6', '2');

    // 2 x 45 + 60 + 5 x 22 + 3 x 28 + 2 x 38 = 420.00, plus 18% GST = 495.60, rounded to 496.00
    await expect(page.getByTestId('bill-total')).toHaveText('496.00');

    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Bill number \d+, total ₹496\.00/)).toBeVisible();
    const seconds = (Date.now() - started) / 1000;
    console.log(
      `5-line cash bill entered and saved in ${seconds.toFixed(1)} s (scripted, with waits)`,
    );
    expect(seconds).toBeLessThan(25);

    // the screen is ready for the next customer
    await expect(page.getByLabel('Item, row 1')).toHaveValue('');

    await page.keyboard.press('Escape');
    await expect(page.getByText('Sales today')).toBeVisible();
    await expect(page.getByText('₹15,672.00')).toBeVisible();
    await expect(page.getByText('5 bills')).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('mistakes are explained in plain words and nothing is lost by pressing Esc', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.keyboard.press('F8');
    await expect(page.getByLabel('Customer')).toBeFocused();
    await page.keyboard.press('Enter'); // Cash
    await expect(page.getByLabel('Item, row 1')).toBeFocused();

    await page.keyboard.press('F2');
    await expect(page.getByText('Please add at least one item.')).toBeVisible();

    await page.keyboard.type('zzz');
    await page.keyboard.press('Enter');
    await expect(page.getByText('no item matches "zzz"')).toBeVisible();

    // leaving with unsaved work asks first; N keeps working, Esc then Y leaves
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog', { name: 'Leave this bill?' })).toBeVisible();
    await page.keyboard.press('N');
    await expect(page.getByRole('heading', { name: 'New Sale' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Y');
    await expect(page.getByText('Sales today')).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('a credit sale to a named customer shows what they owe and takes part payment', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await page.keyboard.press('F8');
    await page.keyboard.press('Control+A');
    await page.keyboard.type('ayap');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Owes you/)).toBeVisible();
    await expect(page.getByLabel('Item, row 1')).toBeFocused();

    await addLine(page, 1, '1500', '4'); // 180.00 + 18% = 212.40, round off to 212.00
    await expect(page.getByTestId('bill-total')).toHaveText('212.00');
    await page.getByLabel('Received now').fill('100');
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Bill number \d+, total ₹212\.00/)).toBeVisible();
  } finally {
    await shop.close();
  }
});
