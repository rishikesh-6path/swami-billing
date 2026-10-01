import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../../src/domain/posting/post.ts';
import { accountLedger } from '../../src/reports/ledger.ts';
import { balanceSheet, profitAndLoss } from '../../src/reports/financials.ts';
import { gstr1, gstr1ToCsvFiles } from '../../src/reports/gst/gstr1.ts';
import { gstSummary, gstSummaryToCsv } from '../../src/reports/gst/summary.ts';
import { outstanding } from '../../src/reports/outstanding.ts';
import { stockStatus } from '../../src/reports/stock.ts';
import { trialBalance } from '../../src/reports/trial-balance.ts';
import { seedShop, type Shop } from '../helpers/shop.ts';

const P = { from: '2026-10-01', to: '2026-10-31' };

function sale(s: Shop, over: object = {}, price = 10000, itemId = 1, qty = 1000) {
  return postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date: '2026-10-05',
    partyAccountId: s.partyB,
    taxMode: 'local',
    roundOff: false,
    lines: [{ itemId, qty, unitId: itemId === 2 ? 2 : 1, listPricePaise: price }],
    ...over,
  });
}
function creditNote(s: Shop, ref: number, price: number, over: object = {}) {
  return postVoucher(s.db, {
    type: 'sales_return',
    seriesId: s.seriesId.sales_return,
    date: '2026-10-09',
    partyAccountId: s.partyB,
    refVoucherId: ref,
    taxMode: 'local',
    roundOff: false,
    lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: price }],
    ...over,
  });
}

describe('place of supply and GSTIN are frozen on the voucher', () => {
  it('needs the customer state for an interstate bill and refuses the shop own state', () => {
    const s = seedShop();
    s.db.exec('UPDATE account SET state_code = NULL WHERE id = 12');
    expect(() => sale(s, { taxMode: 'interstate' })).toThrow(/add the customer's state/);
    s.db.exec("UPDATE account SET state_code = '33' WHERE id = 12");
    expect(() => sale(s, { taxMode: 'interstate' })).toThrow(/your own state/);
  });

  it('will not bill until the shop state is set', () => {
    const s = seedShop();
    s.db.exec("DELETE FROM setting WHERE key = 'company.state_code'");
    expect(() => sale(s)).toThrow(/state in Settings/);
  });

  it('keeps an old invoice B2C when the customer later gets a GSTIN', () => {
    const s = seedShop();
    sale(s);
    s.db.exec("UPDATE account SET gstin = '33ABCDE1234F1Z5' WHERE id = 12");
    const r = gstr1(s.db, P);
    expect(r.b2b).toEqual([]);
    expect(r.b2cs).toHaveLength(1);
  });

  it('keeps a large interstate sale to a party in table 5 whatever the master says later', () => {
    const s = seedShop();
    sale(s, { taxMode: 'interstate' }, 30000000);
    s.db.exec('UPDATE account SET state_code = NULL WHERE id = 12');
    const r = gstr1(s.db, P);
    expect(r.b2cl).toMatchObject([{ pos: '29' }]);
  });
});

describe('GSTR-1 credit notes follow the invoice they refer to', () => {
  it('lists a note against a large unregistered invoice as cdnur, not in table 7', () => {
    const s = seedShop();
    const big = sale(s, { taxMode: 'interstate' }, 30000000);
    creditNote(s, big.voucherId, 20000, { taxMode: 'interstate' });
    const r = gstr1(s.db, P);
    expect(r.b2cl).toHaveLength(1);
    expect(r.b2cs).toEqual([]);
    expect(r.notes).toMatchObject([{ kind: 'cdnur', taxablePaise: 20000, refDocNumber: '1' }]);
    expect(gstr1ToCsvFiles(r)['cdnur.csv']).toContain('B2CL');
  });

  it('reduces table 7 for a note against a small unregistered invoice and does not list it', () => {
    const s = seedShop();
    const small = sale(s, {}, 10000);
    creditNote(s, small.voucherId, 4000);
    const r = gstr1(s.db, P);
    expect(r.b2cs).toMatchObject([{ taxablePaise: 6000 }]);
    expect(r.notes).toEqual([]);
  });
});

describe('GSTR-1 other tables', () => {
  it('reports nil-rated supplies in table 8, not in tables 4 or 7', () => {
    const s = seedShop();
    s.db.exec("UPDATE account SET gstin = '33ABCDE1234F1Z5' WHERE id = 11");
    sale(s, { taxMode: 'exempt' }, 7000, 3);
    sale(s, { taxMode: 'exempt', partyAccountId: s.partyA }, 5000, 3);
    const r = gstr1(s.db, P);
    expect(r.b2b).toEqual([]);
    expect(r.b2cs).toEqual([]);
    expect(r.nilRated).toEqual([
      { description: 'Inter-State supplies to registered persons', taxablePaise: 5000 },
      { description: 'Intra-State supplies to registered persons', taxablePaise: 0 },
      { description: 'Inter-State supplies to unregistered persons', taxablePaise: 7000 },
      { description: 'Intra-State supplies to unregistered persons', taxablePaise: 0 },
    ]);
  });

  it('counts credit-note vouchers in documents issued', () => {
    const s = seedShop();
    const first = sale(s);
    creditNote(s, first.voucherId, 1000);
    postVoucher(s.db, {
      type: 'credit_note',
      seriesId: s.seriesId.credit_note,
      date: '2026-10-10',
      refVoucherId: first.voucherId,
      entries: [
        { accountId: s.partyB, side: 'cr', amountPaise: 100 },
        { accountId: s.cash, side: 'dr', amountPaise: 100 },
      ],
    });
    expect(gstr1(s.db, P).documents.map((d) => [d.nature, d.total])).toEqual([
      ['Invoices for outward supply', 1],
      ['Credit Note', 1],
      ['Credit Note', 1],
    ]);
  });
});

describe('summary CSV', () => {
  it('puts the net payable in its own Total tax column, not under IGST', () => {
    const s = seedShop();
    sale(s);
    const lines = gstSummaryToCsv(gstSummary(s.db, P)).trim().split('\n');
    expect(lines[0]).toBe('Side,Rate,Taxable value,CGST,SGST,IGST,Total tax');
    expect(lines.at(-1)).toBe('Net tax payable,,,,,,18.00');
  });
});

describe('stock valuation', () => {
  function buy(
    s: Shop,
    qty: number,
    price: number,
    type: 'purchase' | 'purchase_return' = 'purchase',
    ref?: number,
  ) {
    return postVoucher(s.db, {
      type,
      seriesId: s.seriesId[type],
      date: '2026-10-01',
      partyAccountId: s.partyB,
      taxMode: 'local',
      roundOff: false,
      refVoucherId: ref,
      lines: [{ itemId: 1, qty, unitId: 1, listPricePaise: price }],
    });
  }

  it('values stock after a purchase return at the price returned', () => {
    const s = seedShop();
    buy(s, 10000, 10000);
    const second = buy(s, 10000, 20000);
    buy(s, 10000, 20000, 'purchase_return', second.voucherId);
    const row = stockStatus(s.db, { asOn: '2026-10-31' }).rows.find((r) => r.itemId === 1)!;
    expect(row.qty).toBe(10000);
    expect(row.valuePaise).toBe(100000); // 10 pcs at 100.00, not at an average of 150.00
  });

  it('keeps stock of an item that is no longer in use in profit and the balance sheet', () => {
    const s = seedShop();
    buy(s, 10000, 10000);
    const before = profitAndLoss(s.db, { from: '2026-04-01', to: '2027-03-31' });
    s.db.exec('UPDATE item SET is_active = 0 WHERE id = 1');
    const after = profitAndLoss(s.db, { from: '2026-04-01', to: '2027-03-31' });
    expect(after.closingStockPaise).toBe(before.closingStockPaise);
    expect(after.closingStockPaise).toBe(100000);
    expect(
      stockStatus(s.db, { asOn: '2026-10-31' }).rows.find((r) => r.itemId === 1),
    ).toBeUndefined();
    const sheet = balanceSheet(s.db, { asOn: '2026-12-31' });
    expect(sheet.closingStockPaise).toBe(100000);
  });
});

describe('outstanding', () => {
  it('ages a brought-forward balance from the start of the books', () => {
    const s = seedShop();
    s.db.exec(
      'UPDATE account SET opening_balance_paise = 5000000, opening_is_dr = 1 WHERE id = 11',
    );
    const [party] = outstanding(s.db, { asOn: '2026-10-01', side: 'receivable' });
    expect(party!.bills[0]!.ageDays).toBeGreaterThan(90);
    expect(party!.buckets.over90).toBe(5000000);
    expect(party!.bills[0]!.isOverdue).toBe(true);
  });
});

describe('a second financial year', () => {
  it('starts income and expense accounts at zero and carries the profit forward', () => {
    const s = seedShop();
    s.db.exec(
      "INSERT INTO financial_year (id, start_date, end_date) VALUES (2, '2027-04-01', '2028-03-31')",
    );
    sale(s, {}, 50000); // FY 2026-27
    postVoucher(s.db, {
      type: 'sales',
      seriesId: s.seriesId.sales,
      date: '2027-05-01',
      partyAccountId: s.partyB,
      taxMode: 'local',
      roundOff: false,
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }],
    });
    const tb = trialBalance(s.db, { from: '2027-04-01', to: '2028-03-31' });
    const salesRow = tb.rows.find((r) => r.accountName === 'Sales')!;
    expect(salesRow.openingPaise).toBe(0);
    expect(salesRow.closingPaise).toBe(-10000);
    const carried = tb.rows.find((r) => r.accountName === 'Profit and loss brought forward')!;
    expect(carried.openingPaise).toBe(-50000);
    expect(tb.closingDrPaise).toBe(tb.closingCrPaise);
    expect(tb.openingDifferencePaise).toBe(0);

    const ledger = accountLedger(s.db, { accountId: 2, from: '2027-04-01', to: '2028-03-31' });
    expect(ledger.openingPaise).toBe(0);
    expect(ledger.closingPaise).toBe(-10000);
  });

  it('shows a cancelled voucher nowhere, including the carried-forward profit', () => {
    const s = seedShop();
    s.db.exec(
      "INSERT INTO financial_year (id, start_date, end_date) VALUES (2, '2027-04-01', '2028-03-31')",
    );
    cancelVoucher(s.db, sale(s, {}, 50000).voucherId);
    const tb = trialBalance(s.db, { from: '2027-04-01', to: '2028-03-31' });
    expect(
      tb.rows.find((r) => r.accountName === 'Profit and loss brought forward'),
    ).toBeUndefined();
  });
});
