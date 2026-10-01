import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../../src/domain/posting/post.ts';
import { PostingError, UnbalancedVoucherError } from '../../src/domain/posting/types.ts';
import { count, seedShop } from '../helpers/shop.ts';

const DATE = '2026-10-01';

function accountTotals(shop: ReturnType<typeof seedShop>, voucherId: number) {
  return shop.db
    .prepare(
      `SELECT a.name AS name, SUM(j.dr_paise) AS dr, SUM(j.cr_paise) AS cr
       FROM journal_line j JOIN account a ON a.id = j.account_id
       WHERE j.voucher_id = ? GROUP BY a.name ORDER BY a.name`,
    )
    .all(voucherId)
    .map((r) => [r['name'], Number(r['dr']), Number(r['cr'])]);
}

describe('posting a sales voucher', () => {
  it('posts balanced journal lines, stock-out and an audit row in one transaction', () => {
    const s = seedShop();
    const posted = postVoucher(s.db, {
      type: 'sales',
      seriesId: s.seriesId.sales,
      date: DATE,
      partyAccountId: s.partyA,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 2000, unitId: 1, listPricePaise: 10000 }],
      createdBy: undefined,
    });
    expect(posted).toMatchObject({ number: 1, totalPaise: 23600 });
    expect(accountTotals(s, posted.voucherId)).toEqual([
      ['AYAPPAN PIPE KUTTALAM', 23600, 0],
      ['Output CGST', 0, 1800],
      ['Output SGST', 0, 1800],
      ['Sales', 0, 20000],
    ]);
    expect(s.db.prepare('SELECT qty_out, qty_in FROM stock_movement').all()).toEqual([
      { qty_out: 2000, qty_in: 0 },
    ]);
    expect(count(s.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'create'")).toBe(1);
  });

  it('settles a cash bill on the spot against the party', () => {
    const s = seedShop();
    const posted = postVoucher(s.db, {
      type: 'sales',
      seriesId: s.seriesId.sales,
      date: DATE,
      partyAccountId: s.partyA,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
      settlements: [{ accountId: s.cash, amountPaise: 11800 }],
    });
    const totals = new Map(accountTotals(s, posted.voucherId).map((r) => [String(r[0]), r]));
    expect(totals.get('Cash')).toEqual(['Cash', 11800, 0]);
    expect(totals.get('AYAPPAN PIPE KUTTALAM')).toEqual(['AYAPPAN PIPE KUTTALAM', 11800, 11800]);
  });

  it('applies freight (taxable) and packing (non-taxable) sundries and rounds off', () => {
    const s = seedShop();
    const posted = postVoucher(s.db, {
      type: 'sales',
      seriesId: s.seriesId.sales,
      date: DATE,
      partyAccountId: s.partyA,
      taxMode: 'local',
      lines: [{ itemId: 2, qty: 127050, unitId: 2, listPricePaise: 1234 }],
      sundries: [
        { billSundryId: s.sundry.discount, amountPaise: 5000 },
        { billSundryId: s.sundry.freight, amountPaise: 2500 },
        { billSundryId: s.sundry.packing, amountPaise: 1000 },
      ],
    });
    expect(posted.totalPaise % 100).toBe(0);
    const names = accountTotals(s, posted.voucherId).map((r) => r[0]);
    expect(names).toEqual(
      expect.arrayContaining(['Discount Allowed', 'Freight Income', 'Packing Income']),
    );
  });

  it('freezes the tax rate and HSN on the voucher line', () => {
    const s = seedShop();
    const posted = postVoucher(s.db, {
      type: 'sales',
      seriesId: s.seriesId.sales,
      date: DATE,
      partyAccountId: s.partyA,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    });
    s.db.exec("INSERT INTO item_tax_rate VALUES (1, '2026-10-02', 500)");
    s.db.exec("UPDATE item SET hsn = '99999999' WHERE id = 1");
    const line = s.db
      .prepare('SELECT tax_rate_bp, hsn FROM voucher_item WHERE voucher_id = ?')
      .get(posted.voucherId);
    expect(line).toEqual({ tax_rate_bp: 1800, hsn: '73079990' });
  });

  it('uses the rate effective on the voucher date', () => {
    const s = seedShop();
    s.db.exec(
      "INSERT INTO financial_year (id, start_date, end_date) VALUES (2, '2025-04-01', '2026-03-31')",
    );
    const old = postVoucher(s.db, {
      type: 'sales',
      seriesId: s.seriesId.sales,
      date: '2025-09-21',
      partyAccountId: s.partyA,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    }).voucherId;
    expect(
      s.db.prepare('SELECT tax_rate_bp FROM voucher_item WHERE voucher_id = ?').get(old),
    ).toEqual({ tax_rate_bp: 2800 });
  });
});

describe('purchases and returns mirror sales', () => {
  it('purchase debits Purchase and Input tax, credits the supplier, adds stock', () => {
    const s = seedShop();
    const posted = postVoucher(s.db, {
      type: 'purchase',
      seriesId: s.seriesId.purchase,
      date: DATE,
      partyAccountId: s.partyB,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 5000, unitId: 1, listPricePaise: 10000 }],
    });
    expect(accountTotals(s, posted.voucherId)).toEqual([
      ['Input CGST', 4500, 0],
      ['Input SGST', 4500, 0],
      ['Purchase', 50000, 0],
      ['SELVAM TRADERS', 0, 59000],
    ]);
    expect(count(s.db, 'SELECT SUM(qty_in) AS n FROM stock_movement')).toBe(5000);
  });

  it('sales return reverses the sales direction and brings stock back in', () => {
    const s = seedShop();
    const original = postVoucher(s.db, {
      type: 'sales',
      seriesId: s.seriesId.sales,
      date: DATE,
      partyAccountId: s.partyA,
      taxMode: 'interstate',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    });
    const posted = postVoucher(s.db, {
      type: 'sales_return',
      refVoucherId: original.voucherId,
      seriesId: s.seriesId.sales_return,
      date: DATE,
      partyAccountId: s.partyA,
      taxMode: 'interstate',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    });
    expect(accountTotals(s, posted.voucherId)).toEqual([
      ['AYAPPAN PIPE KUTTALAM', 0, 11800],
      ['Output IGST', 1800, 0],
      ['Sales', 10000, 0],
    ]);
    expect(count(s.db, 'SELECT SUM(qty_in) AS n FROM stock_movement')).toBe(1000);
  });
});

describe('entry vouchers', () => {
  it('posts a receipt: cash debited, party credited', () => {
    const s = seedShop();
    const posted = postVoucher(s.db, {
      type: 'receipt',
      seriesId: s.seriesId.receipt,
      date: DATE,
      partyAccountId: s.partyA,
      entries: [
        { accountId: s.cash, side: 'dr', amountPaise: 50000 },
        { accountId: s.partyA, side: 'cr', amountPaise: 50000 },
      ],
    });
    expect(posted.totalPaise).toBe(50000);
  });

  it('rejects an unbalanced voucher and rolls back everything, including the number', () => {
    const s = seedShop();
    const bad = {
      type: 'journal' as const,
      seriesId: s.seriesId.journal,
      date: DATE,
      entries: [
        { accountId: s.cash, side: 'dr' as const, amountPaise: 100 },
        { accountId: s.partyA, side: 'cr' as const, amountPaise: 99 },
      ],
    };
    expect(() => postVoucher(s.db, bad)).toThrow(UnbalancedVoucherError);
    expect(count(s.db, 'SELECT COUNT(*) AS n FROM voucher')).toBe(0);
    expect(count(s.db, 'SELECT COUNT(*) AS n FROM journal_line')).toBe(0);
    expect(count(s.db, 'SELECT COUNT(*) AS n FROM voucher_counter')).toBe(0);
    // the failed attempt did not burn number 1
    const good = postVoucher(s.db, {
      ...bad,
      entries: [
        { accountId: s.cash, side: 'dr', amountPaise: 100 },
        { accountId: s.partyA, side: 'cr', amountPaise: 100 },
      ],
    });
    expect(good.number).toBe(1);
  });
});

describe('guards', () => {
  const base = (s: ReturnType<typeof seedShop>) => ({
    type: 'sales' as const,
    seriesId: s.seriesId.sales,
    date: DATE,
    partyAccountId: s.partyA,
    taxMode: 'local' as const,
    lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
  });

  it('rejects a series that belongs to another voucher type', () => {
    const s = seedShop();
    expect(() => postVoucher(s.db, { ...base(s), seriesId: s.seriesId.purchase })).toThrow(
      /not sales/,
    );
  });

  it('rejects a date outside every financial year and a locked year', () => {
    const s = seedShop();
    expect(() => postVoucher(s.db, { ...base(s), date: '2030-01-01' })).toThrow(
      /No financial year/,
    );
    s.db.exec('UPDATE financial_year SET is_locked = 1');
    expect(() => postVoucher(s.db, base(s))).toThrow(/locked/);
  });

  it('rejects an item with no tax rate unless the sale is exempt', () => {
    const s = seedShop();
    s.db.exec(
      "INSERT INTO item (id, name, group_id, unit_id, hsn) VALUES (9, 'NO RATE', 1, 1, '1234')",
    );
    const input = { ...base(s), lines: [{ itemId: 9, qty: 1000, unitId: 1, listPricePaise: 100 }] };
    expect(() => postVoucher(s.db, input)).toThrow(PostingError);
    expect(() => postVoucher(s.db, { ...input, taxMode: 'exempt' })).not.toThrow();
  });

  it('rejects settlements larger than the total', () => {
    const s = seedShop();
    expect(() =>
      postVoucher(s.db, { ...base(s), settlements: [{ accountId: s.cash, amountPaise: 999999 }] }),
    ).toThrow(/exceed/);
  });
});

describe('numbering', () => {
  it('is gap-free and per financial-year series', () => {
    const s = seedShop();
    const numbers = [1, 2, 3].map(
      () =>
        postVoucher(s.db, {
          type: 'receipt',
          seriesId: s.seriesId.receipt,
          date: DATE,
          entries: [
            { accountId: s.cash, side: 'dr', amountPaise: 100 },
            { accountId: s.partyA, side: 'cr', amountPaise: 100 },
          ],
        }).number,
    );
    expect(numbers).toEqual([1, 2, 3]);
  });
});

describe('cancelling', () => {
  function postSale(s: ReturnType<typeof seedShop>) {
    return postVoucher(s.db, {
      type: 'sales',
      seriesId: s.seriesId.sales,
      date: DATE,
      partyAccountId: s.partyA,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 3000, unitId: 1, listPricePaise: 10000 }],
    }).voucherId;
  }

  it('cancelling a sales voucher restores stock and nets the ledger to zero', () => {
    const s = seedShop();
    const id = postSale(s);
    const originals = s.db
      .prepare('SELECT * FROM journal_line WHERE voucher_id = ? ORDER BY id')
      .all(id);
    cancelVoucher(s.db, id);

    expect(count(s.db, 'SELECT SUM(qty_in) - SUM(qty_out) AS n FROM stock_movement')).toBe(0);
    expect(
      count(
        s.db,
        'SELECT SUM(dr_paise) - SUM(cr_paise) AS n FROM journal_line WHERE account_id = ?',
        s.partyA,
      ),
    ).toBe(0);
    // originals untouched, reversals appended
    const after = s.db
      .prepare('SELECT * FROM journal_line WHERE voucher_id = ? AND is_reversal = 0 ORDER BY id')
      .all(id);
    expect(after).toEqual(originals);
    expect(count(s.db, 'SELECT COUNT(*) AS n FROM journal_line WHERE is_reversal = 1')).toBe(
      originals.length,
    );
    expect(s.db.prepare('SELECT status FROM voucher WHERE id = ?').get(id)).toEqual({
      status: 'cancelled',
    });
    expect(count(s.db, "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'cancel'")).toBe(1);
  });

  it('keeps the number of a cancelled voucher so numbering stays gap-free', () => {
    const s = seedShop();
    const id = postSale(s);
    cancelVoucher(s.db, id);
    const next = postSale(s);
    expect(s.db.prepare('SELECT number FROM voucher WHERE id = ?').get(next)).toEqual({
      number: 2,
    });
  });

  it('refuses to cancel twice', () => {
    const s = seedShop();
    const id = postSale(s);
    cancelVoucher(s.db, id);
    expect(() => cancelVoucher(s.db, id)).toThrow(/not posted/);
  });
});

describe('review guards', () => {
  const sale = (s: ReturnType<typeof seedShop>, over: object = {}) => ({
    type: 'sales' as const,
    seriesId: s.seriesId.sales,
    date: DATE,
    partyAccountId: s.partyA,
    taxMode: 'local' as const,
    lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    ...over,
  });
  const ret = (s: ReturnType<typeof seedShop>, over: object = {}) => ({
    type: 'sales_return' as const,
    seriesId: s.seriesId.sales_return,
    date: DATE,
    partyAccountId: s.partyA,
    taxMode: 'local' as const,
    lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    ...over,
  });

  it('cannot cancel a voucher in a locked financial year', () => {
    const s = seedShop();
    const id = postVoucher(s.db, sale(s)).voucherId;
    s.db.exec('UPDATE financial_year SET is_locked = 1');
    expect(() => cancelVoucher(s.db, id)).toThrow(/locked/);
    expect(count(s.db, 'SELECT COUNT(*) AS n FROM journal_line WHERE is_reversal = 1')).toBe(0);
  });

  it('requires returns and notes to reference the original invoice', () => {
    const s = seedShop();
    expect(() => postVoucher(s.db, ret(s))).toThrow(/must reference the original invoice/);
    expect(() =>
      postVoucher(s.db, {
        type: 'credit_note',
        seriesId: s.seriesId.credit_note,
        date: DATE,
        entries: [
          { accountId: s.partyA, side: 'dr', amountPaise: 100 },
          { accountId: s.cash, side: 'cr', amountPaise: 100 },
        ],
      }),
    ).toThrow(/original invoice/);
  });

  it('rejects a reference to the wrong type, a cancelled invoice, or a later date', () => {
    const s = seedShop();
    const purchase = postVoucher(s.db, {
      ...sale(s),
      type: 'purchase',
      seriesId: s.seriesId.purchase,
    });
    expect(() => postVoucher(s.db, ret(s, { refVoucherId: purchase.voucherId }))).toThrow(
      /posted sales/,
    );
    const later = postVoucher(s.db, sale(s, { date: '2026-11-01' }));
    expect(() => postVoucher(s.db, ret(s, { refVoucherId: later.voucherId }))).toThrow(
      /before the invoice/,
    );
    const gone = postVoucher(s.db, sale(s));
    cancelVoucher(s.db, gone.voucherId);
    expect(() => postVoucher(s.db, ret(s, { refVoucherId: gone.voucherId }))).toThrow(
      /posted sales/,
    );
    expect(() => postVoucher(s.db, ret(s, { refVoucherId: 999 }))).toThrow(/does not exist/);
  });

  it('lets the importer skip reference and HSN checks only with legacyImport', () => {
    const s = seedShop();
    s.db.exec('UPDATE item SET hsn = NULL WHERE id = 1');
    expect(() => postVoucher(s.db, sale(s))).toThrow(/HSN/);
    expect(() => postVoucher(s.db, sale(s), { legacyImport: true })).not.toThrow();
    expect(() => postVoucher(s.db, ret(s), { legacyImport: true })).not.toThrow();
  });

  it('requires an HSN of at least 4 digits on sales', () => {
    const s = seedShop();
    const line = { itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000, hsn: '12' };
    expect(() => postVoucher(s.db, sale(s, { lines: [line] }))).toThrow(/HSN/);
  });

  it('keeps the tax mode consistent with the sale type', () => {
    const s = seedShop();
    s.db.exec("INSERT INTO sale_type (id, name, tax_mode) VALUES (1, 'Outstation', 'interstate')");
    expect(() => postVoucher(s.db, sale(s, { saleTypeId: 1 }))).toThrow(/interstate/);
    expect(() =>
      postVoucher(s.db, sale(s, { saleTypeId: 1, taxMode: 'interstate' })),
    ).not.toThrow();
  });

  it('freezes no tax rate on an exempt sale', () => {
    const s = seedShop();
    const id = postVoucher(s.db, sale(s, { taxMode: 'exempt' })).voucherId;
    expect(
      s.db.prepare('SELECT tax_rate_bp FROM voucher_item WHERE voucher_id = ?').get(id),
    ).toEqual({ tax_rate_bp: 0 });
  });

  it('checks the line unit against the item and refuses decimals on whole-number units', () => {
    const s = seedShop();
    const line = { itemId: 1, qty: 1000, unitId: 2, listPricePaise: 10000 };
    expect(() => postVoucher(s.db, sale(s, { lines: [line] }))).toThrow(/different unit/);
    expect(() =>
      postVoucher(s.db, sale(s, { lines: [{ ...line, unitId: 1, qty: 1500 }] })),
    ).toThrow(/whole units/);
  });

  it('rejects dates that are not real calendar dates', () => {
    const s = seedShop();
    expect(() => postVoucher(s.db, sale(s, { date: '2026-13-45' }))).toThrow(/Invalid date/);
    expect(() => postVoucher(s.db, sale(s, { date: '2026-02-30' }))).toThrow(/Invalid date/);
  });

  it('posts equal CGST and SGST on an odd-paisa line', () => {
    const s = seedShop();
    const id = postVoucher(
      s.db,
      sale(s, {
        roundOff: false,
        lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 50 }],
      }),
    ).voucherId;
    const row = s.db
      .prepare('SELECT cgst_paise, sgst_paise FROM voucher_item WHERE voucher_id = ?')
      .get(id);
    expect(row).toEqual({ cgst_paise: 5, sgst_paise: 5 });
  });
});
