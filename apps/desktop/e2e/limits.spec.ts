import { expect, test, type Page } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

type Invoke = (channel: string, request: unknown) => Promise<unknown>;

/** Calls main directly and returns "ok" or the plain message main refused with. */
async function callMain(page: Page, channel: string, request: unknown): Promise<string> {
  return page.evaluate(
    async ([c, r]) => {
      try {
        const api = (globalThis as unknown as { shopledger: { invoke: Invoke } }).shopledger;
        await api.invoke(c, r);
        return 'ok';
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [channel, request] as const,
  );
}

/** Gives Selvam Traders a credit limit of one rupee, so any bill left unpaid goes above it. */
async function limitSelvam(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = (globalThis as unknown as { shopledger: { invoke: Invoke } }).shopledger;
    const hits = (await api.invoke('party.search', {
      text: 'Selvam',
      kind: 'customer',
      asOn: '2026-10-15',
    })) as { id: number }[];
    const id = hits[0]!.id;
    const p = (await api.invoke('party.get', { id })) as Record<string, unknown>;
    await api.invoke('party.save', {
      id,
      name: p['name'],
      gstin: p['gstin'] ?? null,
      stateCode: p['stateCode'] ?? null,
      phone: p['phone'] ?? null,
      address: p['address'] ?? null,
      creditDays: p['creditDays'],
      creditLimitPaise: 100,
      openingBalancePaise: p['openingBalancePaise'],
      openingIsDr: p['openingIsDr'],
    });
  });
}

async function startSelvamBill(page: Page): Promise<void> {
  await page.keyboard.press('F8');
  await expect(page.getByLabel('Customer')).toBeFocused();
  await page.getByLabel('Customer').fill('Selvam Traders');
  await expect(page.getByRole('option', { name: /Selvam Traders/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Item, row 1')).toBeFocused();
  await page.keyboard.type('1500');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Quantity, row 1')).toBeFocused();
  await page.keyboard.type('3');
}

test('the owner is warned about a credit limit and may go on; the bill is saved', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await limitSelvam(page);
    await startSelvamBill(page);
    await expect(page.getByText(/would owe .* after this bill/)).toBeVisible();
    await page.keyboard.press('F2');
    const dialog = page.getByRole('alertdialog', { name: 'Above the credit limit' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'No, go back' }).click();
    await expect(page.getByText(/Saved\. Bill number/)).toHaveCount(0);
    await page.keyboard.press('F2');
    await page
      .getByRole('alertdialog', { name: 'Above the credit limit' })
      .getByRole('button', { name: 'Yes, save the bill' })
      .click();
    await expect(page.getByText(/Saved\. Bill number/)).toBeVisible();
  } finally {
    await shop.close();
  }
});

test('staff are stopped by the credit limit and by the discount limit', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page);
    await limitSelvam(page);
    expect(await callMain(page, 'settings.saveLimits', { staffMaxDiscountBp: 500 })).toBe('ok');
    await page.keyboard.press('Escape');
    // sign out and in as staff
    await page.evaluate(async () => {
      const api = (globalThis as unknown as { shopledger: { invoke: Invoke } }).shopledger;
      await api.invoke('auth.logout', {});
    });
    await page.reload();
    await signIn(page, 'Staff', '1111');
    await expect(page.getByText('Sales today')).toBeVisible();

    await startSelvamBill(page);
    await page.keyboard.press('F2');
    await expect(page.getByText(/Please ask the owner/)).toBeVisible();
    await expect(page.getByText(/Saved\. Bill number/)).toHaveCount(0);

    const discount = await callMain(page, 'voucher.post', {
      type: 'sales',
      date: '2026-10-15',
      partyAccountId: 1,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 4500, discBp: 1000 }],
    });
    expect(discount).toMatch(/more than 5%/);
    const fine = await callMain(page, 'voucher.post', {
      type: 'sales',
      date: '2026-10-15',
      partyAccountId: 1,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 4500, discBp: 500 }],
    });
    expect(fine).toBe('ok');

    // staff cannot change a customer's credit limit themselves
    const selvamId = await page.evaluate(async () => {
      const api = (globalThis as unknown as { shopledger: { invoke: Invoke } }).shopledger;
      const hits = (await api.invoke('party.search', {
        text: 'Selvam',
        kind: 'customer',
        asOn: '2026-10-15',
      })) as { id: number }[];
      return hits[0]!.id;
    });
    const raise = await callMain(page, 'party.save', {
      id: selvamId,
      name: 'Selvam Traders',
      gstin: null,
      stateCode: null,
      phone: null,
      address: null,
      creditDays: 0,
      creditLimitPaise: 0,
      openingBalancePaise: 0,
      openingIsDr: true,
    });
    expect(raise).toMatch(/credit limit is for the owner|owner/);

    // a payment that gives Selvam money takes them over the limit: refused for staff
    const cashId = await page.evaluate(async () => {
      const api = (globalThis as unknown as { shopledger: { invoke: Invoke } }).shopledger;
      const setup = (await api.invoke('voucher.setup', {
        type: 'sales',
        date: '2026-10-15',
      })) as { cashAccountId: number };
      return setup.cashAccountId;
    });
    const payment = await callMain(page, 'voucher.post', {
      type: 'payment',
      date: '2026-10-15',
      partyAccountId: selvamId,
      entries: [
        { accountId: selvamId, side: 'dr', amountPaise: 50000 },
        { accountId: cashId, side: 'cr', amountPaise: 50000 },
      ],
    });
    expect(payment).toMatch(/above their credit limit/);

    // an existing item's price is the owner's
    const item = await page.evaluate(async () => {
      const api = (globalThis as unknown as { shopledger: { invoke: Invoke } }).shopledger;
      return (await api.invoke('item.get', { id: 1 })) as { item: Record<string, unknown> };
    });
    const cheaper = await callMain(page, 'item.save', {
      id: 1,
      name: item.item['name'],
      alias: item.item['alias'],
      groupId: item.item['groupId'],
      unitId: item.item['unitId'],
      hsn: item.item['hsn'],
      openingQty: item.item['openingQty'],
      openingRatePaise: item.item['openingRatePaise'],
      salePricePaise: 100,
      mrpPaise: item.item['mrpPaise'],
      minStockQty: item.item['minStockQty'],
    });
    expect(cheaper).toMatch(/changed by the owner/);

    // turning a customer's opening balance from Dr to Cr is an opening change: owner only
    const flipped = await page.evaluate(async () => {
      const api = (globalThis as unknown as { shopledger: { invoke: Invoke } }).shopledger;
      const hits = (await api.invoke('party.search', {
        text: 'Ayappan',
        kind: 'customer',
        asOn: '2026-10-15',
      })) as { id: number }[];
      const p = (await api.invoke('party.get', { id: hits[0]!.id })) as Record<string, unknown>;
      try {
        await api.invoke('party.save', {
          id: hits[0]!.id,
          name: p['name'],
          gstin: p['gstin'] ?? null,
          stateCode: p['stateCode'] ?? null,
          phone: p['phone'] ?? null,
          address: p['address'] ?? null,
          creditDays: p['creditDays'],
          openingBalancePaise: p['openingBalancePaise'],
          openingIsDr: !p['openingIsDr'],
        });
        return 'ok';
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    });
    expect(flipped).toMatch(/entered by the owner/);
  } finally {
    await shop.close();
  }
});
