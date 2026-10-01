import { expect, test, type Page } from '@playwright/test';
import { launch, signIn } from './helpers.ts';

type Invoke = (channel: string, request: unknown) => Promise<{ ok: boolean; message?: string }>;

/** Calls main directly, as a compromised or buggy screen would, and returns what main answered. */
async function callMain(page: Page, channel: string, request: unknown) {
  return page.evaluate(
    async ([c, r]) => {
      try {
        const api = (window as unknown as { shopledger: { invoke: Invoke } }).shopledger;
        await api.invoke(c, r);
        return 'ok';
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [channel, request] as const,
  );
}

test('staff cannot post owner entries, open owner accounts or cancel without a reason', async () => {
  const shop = await launch({ demo: true });
  try {
    const { page } = shop;
    await signIn(page, 'Staff', '1111');
    await expect(page.getByText('Sales today')).toBeVisible();
    await expect(page.getByRole('button', { name: /Journal Entry/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Stock Count/ })).toHaveCount(0);

    const journal = await callMain(page, 'voucher.post', {
      type: 'journal',
      date: '2026-10-15',
      entries: [
        { accountId: 1, side: 'dr', amountPaise: 100 },
        { accountId: 2, side: 'cr', amountPaise: 100 },
      ],
    });
    expect(journal).toMatch(/for the owner/);

    const hits = await page.evaluate(async () => {
      const api = (window as unknown as { shopledger: { invoke: Invoke } }).shopledger;
      return await api.invoke('account.search', {
        text: 'capital',
        kind: 'any',
        asOn: '2026-10-15',
      });
    });
    expect(JSON.stringify(hits)).not.toMatch(/Capital/i);

    const blankReason = await callMain(page, 'voucher.cancel', { id: 1, reason: ' ' });
    expect(blankReason).toMatch(/not valid/);
  } finally {
    await shop.close();
  }
});
