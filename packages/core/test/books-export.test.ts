import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../src/domain/posting/post.ts';
import {
  accountantFiles,
  importItemsCsv,
  importPartiesCsv,
  itemsCsv,
  journalCsv,
  partiesCsv,
  salesRegister,
  updateAccount,
  vouchersCsv,
} from '../src/index.ts';
import { parseCsv } from '../src/import/csv.ts';
import { toCsv } from '../src/reports/csv.ts';
import { freshDb } from './helpers/db.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

const P = { from: '2026-10-01', to: '2026-10-31' };
const money = (text: string | undefined) => Math.round(Number(text || '0') * 100);

function shopWithActivity(): Shop {
  const s = seedShop();
  const sale = (date: string, qty: number) =>
    postVoucher(s.db, {
      type: 'sales',
      seriesId: s.seriesId.sales,
      date,
      partyAccountId: s.partyA,
      taxMode: 'local',
      roundOff: false,
      narration: 'Goods, "special" order',
      lines: [{ itemId: 1, qty, unitId: 1, listPricePaise: 10000 }],
    });
  sale('2026-10-05', 10000);
  sale('2026-10-06', 5000);
  cancelVoucher(s.db, sale('2026-10-07', 1000).voucherId);
  postVoucher(s.db, {
    type: 'purchase',
    seriesId: s.seriesId.purchase,
    date: '2026-10-08',
    partyAccountId: s.partyB,
    taxMode: 'local',
    roundOff: false,
    partyBillNo: 'SUP/1',
    partyBillDate: '2026-10-07',
    lines: [{ itemId: 1, qty: 20000, unitId: 1, listPricePaise: 8000 }],
  });
  return s;
}

describe('data for the accountant', () => {
  it('lists every bill with its status, and its totals agree with the sales register', () => {
    const s = shopWithActivity();
    const [header, ...rows] = parseCsv(vouchersCsv(s.db, P)).filter((r) => r.length > 1);
    expect(header![0]).toBe('Date');
    expect(rows).toHaveLength(4); // three sales (one cancelled) and a purchase
    expect(rows.every((r) => r.length === header!.length)).toBe(true);
    const col = (name: string) => header!.indexOf(name);
    expect(rows.filter((r) => r[col('Status')] === 'Cancelled')).toHaveLength(1);
    const liveSales = rows.filter(
      (r) => r[col('Type')] === 'Sales' && r[col('Status')] === 'Posted',
    );
    const reg = salesRegister(s.db, P);
    expect(liveSales.reduce((t, r) => t + money(r[col('Total')]), 0)).toBe(reg.totals.totalPaise);
    expect(liveSales.reduce((t, r) => t + money(r[col('Taxable')]), 0)).toBe(
      reg.totals.taxablePaise,
    );
    const purchase = rows.find((r) => r[col('Type')] === 'Purchase')!;
    expect(purchase[col("Supplier's invoice no.")]).toBe('SUP/1');
    expect(rows[0]![col('Narration')]).toBe('Goods, "special" order'); // quotes survive
    expect(rows[0]![col('Financial year')]).toBe('2026-27');
    // the signed column adds up to the register, with nothing for the cancelled bill
    const sales = rows.filter((r) => r[col('Type')] === 'Sales');
    expect(sales.reduce((t, r) => t + money(r[col('Total for adding up')]), 0)).toBe(
      reg.totals.totalPaise,
    );
    expect(rows.find((r) => r[col('Status')] === 'Cancelled')![col('Total for adding up')]).toBe(
      '0.00',
    );
    // each row foots: taxable + tax + other charges + round off = total
    for (const r of rows) {
      const tax = money(r[col('CGST')]) + money(r[col('SGST')]) + money(r[col('IGST')]);
      expect(
        money(r[col('Taxable')]) +
          tax +
          money(r[col('Other charges')]) +
          money(r[col('Round off')]),
      ).toBe(money(r[col('Total')]));
    }
  });

  it('has ledger lines whose debits and credits are equal, with the reversal of a cancelled bill', () => {
    const s = shopWithActivity();
    const [header, ...rows] = parseCsv(journalCsv(s.db, P)).filter((r) => r.length > 1);
    const dr = rows.reduce((t, r) => t + money(r[header!.indexOf('Debit')]), 0);
    const cr = rows.reduce((t, r) => t + money(r[header!.indexOf('Credit')]), 0);
    expect(dr).toBe(cr);
    expect(dr).toBeGreaterThan(0);
    expect(rows.some((r) => r[header!.indexOf('Reversal of a cancelled bill')] === 'Yes')).toBe(
      true,
    );
    expect(rows.every((r) => r.length === header!.length)).toBe(true);
  });

  it('only covers the period asked for', () => {
    const s = shopWithActivity();
    expect(
      parseCsv(vouchersCsv(s.db, { from: '2026-10-06', to: '2026-10-06' })).filter(
        (r) => r.length > 1,
      ),
    ).toHaveLength(2);
    expect(
      parseCsv(vouchersCsv(s.db, { from: '2027-01-01', to: '2027-01-31' })).filter(
        (r) => r.length > 1,
      ),
    ).toHaveLength(1); // header only
  });

  it('exports items and parties so that importing them again gives the same lists', () => {
    const s = seedShop();
    s.db.exec(`
      UPDATE item SET sale_price_paise = 4500, mrp_paise = 5000, min_stock_qty = 20000, opening_qty = 100000, opening_rate_paise = 3000 WHERE id = 1;
      UPDATE item SET sale_price_paise = 2233 WHERE id = 2;
    `);
    updateAccount(s.db, s.partyA, {
      creditDays: 15,
      creditLimitPaise: 250000,
      phone: '9876543210',
      address: '12 Main Road, Salem',
    });
    const items = itemsCsv(s.db, '2026-10-31');
    const customers = partiesCsv(s.db, 'customer');
    const suppliers = partiesCsv(s.db, 'supplier');

    const fresh = freshDb();
    expect(importItemsCsv(fresh, items)).toMatchObject({ created: 3, skipped: [] });
    expect(importPartiesCsv(fresh, customers, 'customer')).toMatchObject({ skipped: [] });
    expect(importPartiesCsv(fresh, suppliers, 'supplier')).toMatchObject({ skipped: [] });
    expect(itemsCsv(fresh, '2026-10-31')).toBe(items);
    expect(partiesCsv(fresh, 'customer')).toBe(customers);
    expect(partiesCsv(fresh, 'supplier')).toBe(suppliers);
    expect(customers).toContain('2500.00');
  });

  it('leaves the bill-only columns empty for receipts, and exports the rate in force on the date', () => {
    const s = shopWithActivity();
    postVoucher(s.db, {
      type: 'receipt',
      seriesId: s.seriesId.receipt,
      date: '2026-10-09',
      partyAccountId: s.partyA,
      entries: [
        { accountId: s.cash, side: 'dr', amountPaise: 500000 },
        { accountId: s.partyA, side: 'cr', amountPaise: 500000 },
      ],
    });
    const [header, ...rows] = parseCsv(vouchersCsv(s.db, P)).filter((r) => r.length > 1);
    const receipt = rows.find((r) => r[header!.indexOf('Type')] === 'Receipt')!;
    expect(receipt[header!.indexOf('Other charges')]).toBe('');
    expect(receipt[header!.indexOf('Total for adding up')]).toBe('');
    s.db.exec(
      "INSERT INTO item_tax_rate (item_id, effective_from, rate_bp) VALUES (1, '2026-12-01', 500)",
    );
    expect(itemsCsv(s.db, '2026-10-31')).toContain(',18,');
    expect(itemsCsv(s.db, '2026-12-31')).toContain(',5,');
  });

  it('writes phone numbers as they are, but still guards against formulas', () => {
    expect(toCsv(['Phone'], [['+91 98765 43210'], ['(0427) 245-1234'], ['=HYPERLINK("x")']])).toBe(
      'Phone\n+91 98765 43210\n(0427) 245-1234\n"\'=HYPERLINK(""x"")"\n',
    );
  });

  it('bundles the files with a plain note', () => {
    const s = shopWithActivity();
    const files = accountantFiles(s.db, P);
    expect(Object.keys(files).sort()).toEqual([
      'Bills and entries.csv',
      'Customers.csv',
      'Items.csv',
      'Ledger lines.csv',
      'Read me.txt',
      'Suppliers.csv',
    ]);
    expect(files['Read me.txt']).toContain('2026-10-01 to 2026-10-31');
  });
});
