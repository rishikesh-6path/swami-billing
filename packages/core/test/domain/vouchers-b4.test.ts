import { describe, expect, it } from 'vitest';
import { closeDay } from '../../src/books/control.ts';
import { cancelVoucher, postVoucher } from '../../src/domain/posting/post.ts';
import { modifyVoucher } from '../../src/domain/posting/modify.ts';
import type { EntryVoucherInput, VoucherInput } from '../../src/domain/posting/types.ts';
import { stockStatus } from '../../src/reports/stock.ts';
import { count, seedShop, type Shop } from '../helpers/shop.ts';

const D = '2026-10-01';

function entry(
  s: Shop,
  type: EntryVoucherInput['type'],
  dr: number,
  cr: number,
): EntryVoucherInput {
  return {
    type,
    seriesId: s.seriesId[type],
    date: D,
    entries: [
      { accountId: dr, side: 'dr', amountPaise: 500 },
      { accountId: cr, side: 'cr', amountPaise: 500 },
    ],
  };
}
const qty = (s: Shop, itemId = 1) =>
  stockStatus(s.db, { asOn: '2027-03-31' }).rows.find((r) => r.itemId === itemId)!.qty;

describe('cash and bank rules for entry vouchers', () => {
  it('a receipt debits cash or bank and credits the party', () => {
    const s = seedShop();
    expect(() => postVoucher(s.db, entry(s, 'receipt', s.cash, s.partyA))).not.toThrow();
    expect(() => postVoucher(s.db, entry(s, 'receipt', s.gpay, s.partyA))).not.toThrow(); // bank / UPI
    expect(() => postVoucher(s.db, entry(s, 'receipt', s.partyB, s.partyA))).toThrow(
      /must go into Cash or a bank account/,
    );
    expect(() => postVoucher(s.db, entry(s, 'receipt', s.cash, s.gpay))).toThrow(
      /must go into Cash or a bank account/,
    );
  });

  it('a payment credits cash or bank and debits the party or an expense', () => {
    const s = seedShop();
    expect(() => postVoucher(s.db, entry(s, 'payment', s.partyB, s.cash))).not.toThrow();
    expect(() => postVoucher(s.db, entry(s, 'payment', s.cash, s.partyB))).toThrow(
      /must come out of Cash or a bank/,
    );
  });

  it('a contra moves money only between cash and bank', () => {
    const s = seedShop();
    expect(() => postVoucher(s.db, entry(s, 'contra', s.gpay, s.cash))).not.toThrow();
    expect(() => postVoucher(s.db, entry(s, 'contra', s.partyA, s.cash))).toThrow(
      /between Cash and Bank/,
    );
  });

  it('journals and notes cannot touch cash or bank', () => {
    const s = seedShop();
    expect(() => postVoucher(s.db, entry(s, 'journal', s.partyA, s.partyB))).not.toThrow();
    expect(() => postVoucher(s.db, entry(s, 'journal', s.cash, s.partyB))).toThrow(
      /Receipt, Payment or Contra/,
    );
  });
});

describe('returns cannot exceed the bill', () => {
  const sale = (s: Shop, q: number) =>
    postVoucher(s.db, {
      type: 'sales',
      seriesId: s.seriesId.sales,
      date: D,
      partyAccountId: s.partyA,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: q, unitId: 1, listPricePaise: 10000 }],
    });
  const ret = (s: Shop, ref: number, q: number, itemId = 1) =>
    postVoucher(s.db, {
      type: 'sales_return',
      seriesId: s.seriesId.sales_return,
      date: D,
      partyAccountId: s.partyA,
      refVoucherId: ref,
      taxMode: 'local',
      lines: [{ itemId, qty: q, unitId: itemId === 2 ? 2 : 1, listPricePaise: 10000 }],
    });

  it('allows part returns up to the sold quantity and then refuses', () => {
    const s = seedShop();
    const bill = sale(s, 5000).voucherId;
    expect(() => ret(s, bill, 2000)).not.toThrow();
    expect(() => ret(s, bill, 3000)).not.toThrow();
    expect(() => ret(s, bill, 1000)).toThrow(
      /more of "GI CLAMP" than the bill allows \(bill 5, already returned 5\)/,
    );
  });

  it('counts a cancelled return as not returned, and rejects items not on the bill', () => {
    const s = seedShop();
    const bill = sale(s, 5000).voucherId;
    cancelVoucher(s.db, ret(s, bill, 5000).voucherId);
    expect(() => ret(s, bill, 5000)).not.toThrow();
    expect(() => ret(s, bill, 1000, 2)).toThrow(/not on the bill/);
  });
});

describe('stock journal', () => {
  const journal = (
    s: Shop,
    lines: Extract<VoucherInput, { type: 'stock_journal' }>['lines'],
  ): VoucherInput => ({
    type: 'stock_journal',
    seriesId: s.seriesId.stock_journal,
    date: D,
    lines,
  });

  it('moves stock between items without touching the accounts', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET opening_qty = 10000 WHERE id = 2'); // 10 m of pipe
    postVoucher(
      s.db,
      journal(s, [
        { itemId: 2, unitId: 2, qty: 6000, direction: 'out' },
        { itemId: 1, unitId: 1, qty: 3000, direction: 'in', ratePaise: 7000 },
      ]),
    );
    expect(qty(s, 2)).toBe(4000);
    expect(qty(s, 1)).toBe(3000);
    expect(count(s.db, 'SELECT COUNT(*) AS n FROM journal_line')).toBe(0);
    // received stock is valued at the cost given
    expect(
      stockStatus(s.db, { asOn: '2027-03-31' }).rows.find((r) => r.itemId === 1)!.valuePaise,
    ).toBe(21000);
  });

  it('needs items both issued and received, a cost for received items, and positive quantities', () => {
    const s = seedShop();
    expect(() =>
      postVoucher(s.db, journal(s, [{ itemId: 2, unitId: 2, qty: 1000, direction: 'out' }])),
    ).toThrow(/issued and items received/);
    expect(() =>
      postVoucher(
        s.db,
        journal(s, [
          { itemId: 2, unitId: 2, qty: 1000, direction: 'out' },
          { itemId: 1, unitId: 1, qty: 1000, direction: 'in' },
        ]),
      ),
    ).toThrow(/cost per unit/);
    expect(() => postVoucher(s.db, journal(s, []))).toThrow(/at least one item/);
    expect(() =>
      postVoucher(
        s.db,
        journal(s, [
          { itemId: 2, unitId: 2, qty: 0, direction: 'out' },
          { itemId: 1, unitId: 1, qty: 1000, direction: 'in', ratePaise: 1 },
        ]),
      ),
    ).toThrow(/quantity above zero/);
  });

  it('can be cancelled, which puts the stock back', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET opening_qty = 10000 WHERE id = 2');
    const id = postVoucher(
      s.db,
      journal(s, [
        { itemId: 2, unitId: 2, qty: 6000, direction: 'out' },
        { itemId: 1, unitId: 1, qty: 3000, direction: 'in', ratePaise: 7000 },
      ]),
    ).voucherId;
    cancelVoucher(s.db, id);
    expect(qty(s, 2)).toBe(10000);
    expect(qty(s, 1)).toBe(0);
  });
});

describe('physical stock', () => {
  const count_ = (s: Shop, counted: number, date = D) =>
    postVoucher(s.db, {
      type: 'physical_stock',
      seriesId: s.seriesId.physical_stock,
      date,
      lines: [{ itemId: 1, unitId: 1, countedQty: counted }],
    });

  it('posts only the difference between the count and the books', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET opening_qty = 10000 WHERE id = 1');
    count_(s, 8000);
    expect(qty(s)).toBe(8000);
    count_(s, 8000, '2026-10-02'); // nothing to correct
    expect(count(s.db, 'SELECT COUNT(*) AS n FROM stock_movement')).toBe(1);
    count_(s, 9000, '2026-10-03');
    expect(qty(s)).toBe(9000);
  });

  it('rejects duplicate items, negative counts and fractions on whole units', () => {
    const s = seedShop();
    const line = { itemId: 1, unitId: 1, countedQty: 1000 };
    const post = (lines: (typeof line)[]) =>
      postVoucher(s.db, {
        type: 'physical_stock',
        seriesId: s.seriesId.physical_stock,
        date: D,
        lines,
      });
    expect(() => post([line, line])).toThrow(/twice/);
    expect(() => post([{ ...line, countedQty: -1000 }])).toThrow(/negative/);
    expect(() => post([{ ...line, countedQty: 1500 }])).toThrow(/whole units/);
  });
});

describe('modifying a voucher', () => {
  const sale = (price: number): VoucherInput => ({
    type: 'sales',
    seriesId: 0,
    date: D,
    partyAccountId: 11,
    taxMode: 'local',
    roundOff: false,
    lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: price }],
  });

  it('cancels the original and posts a linked replacement in one step', () => {
    const s = seedShop();
    const original = postVoucher(s.db, {
      ...sale(10000),
      seriesId: s.seriesId.sales,
    });
    const changed = modifyVoucher(s.db, original.voucherId, {
      ...sale(12000),
      seriesId: s.seriesId.sales,
    });
    expect(changed.replacedVoucherId).toBe(original.voucherId);
    expect(changed.number).toBe(2);
    expect(s.db.prepare('SELECT status FROM voucher WHERE id = ?').get(original.voucherId)).toEqual(
      { status: 'cancelled' },
    );
    expect(
      s.db
        .prepare('SELECT modified_from_id, total_paise FROM voucher WHERE id = ?')
        .get(changed.voucherId),
    ).toEqual({
      modified_from_id: original.voucherId,
      total_paise: 14160,
    });
    expect(count(s.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'modify'")).toBe(1);
    expect(qty(s)).toBe(-1000); // one bill's worth of stock out, not two
  });

  it('keeps everything as it was when the replacement is invalid', () => {
    const s = seedShop();
    const original = postVoucher(s.db, {
      ...sale(10000),
      seriesId: s.seriesId.sales,
    });
    const broken = { ...sale(10000), seriesId: s.seriesId.sales, lines: [] } as VoucherInput;
    expect(() => modifyVoucher(s.db, original.voucherId, broken)).toThrow(/at least one item/);
    expect(s.db.prepare('SELECT status FROM voucher WHERE id = ?').get(original.voucherId)).toEqual(
      { status: 'posted' },
    );
    expect(count(s.db, 'SELECT COUNT(*) AS n FROM voucher')).toBe(1);
  });

  it('refuses when returns exist, when the type differs, or when staff modify a closed day', () => {
    const s = seedShop();
    const original = postVoucher(s.db, {
      ...sale(10000),
      seriesId: s.seriesId.sales,
    });
    expect(() =>
      modifyVoucher(s.db, original.voucherId, {
        ...sale(1),
        type: 'purchase',
        seriesId: s.seriesId.purchase,
      } as VoucherInput),
    ).toThrow(/kind of voucher cannot be changed/);
    closeDay(s.db, D);
    expect(() =>
      modifyVoucher(
        s.db,
        original.voucherId,
        { ...sale(5000), seriesId: s.seriesId.sales },
        { role: 'staff' },
      ),
    ).toThrow(/closed by the owner/);

    postVoucher(s.db, {
      type: 'sales_return',
      seriesId: s.seriesId.sales_return,
      date: '2026-10-02',
      partyAccountId: 11,
      refVoucherId: original.voucherId,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    });
    expect(() =>
      modifyVoucher(s.db, original.voucherId, {
        ...sale(5000),
        seriesId: s.seriesId.sales,
      }),
    ).toThrow(/Returns or notes/);
  });
});
