import { expect, test, type Page } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

type Invoke = (channel: string, request: unknown) => Promise<unknown>;

/** The newest sale to Kumar Constructions (the demo's customer in another state). */
async function newestKumarSale(page: Page) {
  return page.evaluate(async () => {
    const api = (globalThis as unknown as { shopledger: { invoke: Invoke } }).shopledger;
    const list = (await api.invoke('voucher.list', {
      voucherType: 'sales',
      search: 'Kumar',
    })) as { id: number }[];
    const bill = (await api.invoke('voucher.get', { id: list[0]!.id })) as {
      id: number;
      taxMode: string;
      status: string;
    };
    return bill;
  });
}

test('changing an interstate bill keeps IGST', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    const before = await newestKumarSale(page);
    expect(before.taxMode).toBe('interstate');

    await page.keyboard.press('D');
    await expect(page.getByRole('heading', { name: 'Find a Bill' })).toBeVisible();
    await page.getByLabel('Period').selectOption('thisYear');
    await page.getByLabel('Kind').selectOption('sales');
    await page.getByLabel('Words to look for').fill('Kumar');
    await page.getByLabel('Words to look for').press('Enter');
    await expect(page.getByRole('heading', { name: /^Sales / })).toBeVisible();
    await page.keyboard.press('Alt+B');
    await expect(page.getByRole('heading', { name: /^Change Sale/ })).toBeVisible();
    await expect(page.getByText(/Same GST as the original bill\. IGST applies/)).toBeVisible();
    await expect(page.getByLabel('Quantity, row 1')).not.toHaveValue('');
    await page.keyboard.press('F2');
    await expect(page.getByText(/Saved\. Bill number/)).toBeVisible();

    const after = await newestKumarSale(page);
    expect(after.id).not.toBe(before.id);
    expect(after.taxMode).toBe('interstate');
  } finally {
    await shop.close();
  }
});
