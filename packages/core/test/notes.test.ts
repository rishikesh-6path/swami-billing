import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../src/domain/posting/post.ts';
import { getVoucherDetail } from '../src/domain/posting/detail.ts';
import { renderDocument } from '../src/print/invoice.ts';
import { balanceSheet } from '../src/reports/financials.ts';
import { gstr1 } from '../src/reports/gst/gstr1.ts';
import { gstr3b } from '../src/reports/gst/gstr3b.ts';
import { gstSummary } from '../src/reports/gst/summary.ts';
import { salesRegister, purchaseRegister } from '../src/reports/registers.ts';
import { trialBalance } from '../src/reports/trial-balance.ts';
import { count, seedShop, type Shop } from './helpers/shop.ts';

const P = { from: '2026-10-01', to: '2026-10-31' };

// customer B (id 12) is registered for the shop's tests below
function sale(s: Shop, over: object = {}) {
  return postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date: '2026-10-05',
    partyAccountId: s.partyB,
    taxMode: 'local',
    roundOff: false,
    lines: [{ itemId: 1, qty: 10000, unitId: 1, listPricePaise: 10000 }], // taxable 1,00,000 paise
    ...over,
  });
}
function creditNote(s: Shop, ref: number, value: number, over: object = {}) {
  return postVoucher(s.db, {
    type: 'credit_note',
    seriesId: s.seriesId.credit_note,
    date: '2026-10-09',
    partyAccountId: s.partyB,
    refVoucherId: ref,
    taxMode: 'local',
    roundOff: false,
    narration: 'Rate difference agreed with the customer',
    lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: value }],
    ...over,
  });
}

describe('credit note', () => {
  it('posts balanced money and tax entries, no stock, and one value line stored with quantity 0', () => {
    const s = seedShop();
    const original = sale(s);
    const stockBefore = count(s.db, 'SELECT COUNT(*) AS n FROM stock_movement');
    const note = creditNote(s, original.voucherId, 5000); // 50.00 + 18% = 59.00
    expect(note.totalPaise).toBe(5900);
    expect(count(s.db, 'SELECT COUNT(*) AS n FROM stock_movement')).toBe(stockBefore);
    const lines = s.db
      .prepare(
        `SELECT a.name AS name, j.dr_paise AS dr, j.cr_paise AS cr FROM journal_line j
         JOIN account a ON a.id = j.account_id WHERE j.voucher_id = ? ORDER BY j.id`,
      )
      .all(note.voucherId)
      .map((r) => [r['name'], Number(r['dr']), Number(r['cr'])]);
    expect(lines).toEqual([
      ['SELVAM TRADERS', 0, 5900],
      ['Sales', 5000, 0],
      ['Output CGST', 450, 0],
      ['Output SGST', 450, 0],
    ]);
    expect(
      count(s.db, 'SELECT qty AS n FROM voucher_item WHERE voucher_id = ?', note.voucherId),
    ).toBe(0);
  });

  it('is taken off the sale in the GST summary, GSTR-3B, GSTR-1 and the sales register', () => {
    const s = seedShop();
    const original = sale(s); // taxable 1,000.00, CGST 90.00, SGST 90.00
    const note = creditNote(s, original.voucherId, 5000); // taxable 50.00, CGST 4.50, SGST 4.50

    expect(gstSummary(s.db, P).output).toEqual([
      { rateBp: 1800, taxablePaise: 95000, cgstPaise: 8550, sgstPaise: 8550, igstPaise: 0 },
    ]);
    const b = gstr3b(s.db, P);
    expect(b.taxableOutward).toMatchObject({
      taxablePaise: 95000,
      cgstPaise: 8550,
      sgstPaise: 8550,
    });
    expect(b.netTaxPayablePaise).toBe(17100);

    // a small sale to an unregistered customer is in table 7 (b2cs), so the note reduces that row
    const r1 = gstr1(s.db, P);
    expect(r1.b2cs).toHaveLength(1);
    expect(r1.b2cs[0]).toMatchObject({ taxablePaise: 95000 });
    expect(r1.documents.map((d) => [d.nature, d.total])).toEqual([
      ['Invoices for outward supply', 1],
      ['Credit Note', 1],
    ]);
    // the HSN summary reduces the value of the goods but not their quantity
    const hsn = r1.hsn.find((h) => h.hsn === '73079990')!;
    expect(hsn.taxablePaise).toBe(95000);
    expect(hsn.qty).toBe(10000);

    const reg = salesRegister(s.db, P);
    expect(reg.totals.taxablePaise).toBe(95000);
    expect(reg.rows.map((x) => x.voucherType)).toEqual(['sales', 'credit_note']);
    expect(reg.rows.at(-1)?.voucherId).toBe(note.voucherId);
  });

  it('goes to the credit notes table of GSTR-1 when the customer is registered', () => {
    const s = seedShop();
    s.db.exec("UPDATE account SET gstin = '33AAPFU0939F1Z2' WHERE id = 12");
    const original = sale(s);
    creditNote(s, original.voucherId, 5000);
    const r1 = gstr1(s.db, P);
    expect(r1.notes).toHaveLength(1);
    expect(r1.notes[0]).toMatchObject({ kind: 'cdnr', taxablePaise: 5000 });
    expect(r1.b2b[0]).toMatchObject({ taxablePaise: 100000 });
  });

  it('keeps the books balanced and the party owing only the difference', () => {
    const s = seedShop();
    const original = sale(s);
    creditNote(s, original.voucherId, 5000);
    const tb = trialBalance(s.db, { from: '2026-04-01', to: '2027-03-31' });
    expect(tb.totalDrPaise).toBe(tb.totalCrPaise);
    const sheet = balanceSheet(s.db, { asOn: '2027-03-31' });
    expect(sheet.totalAssetsPaise).toBe(sheet.totalLiabilitiesPaise);
    const owed = count(
      s.db,
      'SELECT SUM(dr_paise) - SUM(cr_paise) AS n FROM journal_line WHERE account_id = ?',
      s.partyB,
    );
    expect(owed).toBe(118000 - 5900);
  });

  it('uses the GST rate the original bill charged, even if the item rate has changed since', () => {
    const s = seedShop();
    const original = sale(s); // 18% on 5 Oct
    s.db.exec(
      "INSERT INTO item_tax_rate (item_id, effective_from, rate_bp) VALUES (1, '2026-10-07', 500)",
    );
    const note = creditNote(s, original.voucherId, 5000);
    expect(note.totalPaise).toBe(5900); // 18%, not 5%
    const later = sale(s, { date: '2026-10-08' });
    expect(later.totalPaise).toBe(105000);
  });

  it('is undone completely by cancelling it', () => {
    const s = seedShop();
    const original = sale(s);
    const note = creditNote(s, original.voucherId, 5000);
    cancelVoucher(s.db, note.voucherId);
    expect(gstSummary(s.db, P).output[0]).toMatchObject({ taxablePaise: 100000, cgstPaise: 9000 });
    expect(gstr1(s.db, P).notes).toEqual([]);
  });

  it('needs a reason, the same party, the same tax mode, and cannot exceed the bill', () => {
    const s = seedShop();
    const original = sale(s);
    expect(() => creditNote(s, original.voucherId, 5000, { narration: '  ' })).toThrow(/reason/);
    expect(() => creditNote(s, original.voucherId, 5000, { partyAccountId: s.partyA })).toThrow(
      /same party/,
    );
    expect(() => creditNote(s, original.voucherId, 5000, { taxMode: 'exempt' })).toThrow(
      /must be too/,
    );
    expect(() => creditNote(s, original.voucherId, 101000)).toThrow(/more than the bill itself/);
    creditNote(s, original.voucherId, 60000); // 59,000 + tax = 70,800 of 1,18,000
    expect(() => creditNote(s, original.voucherId, 60000)).toThrow(/more than the bill itself/);
    expect(() => creditNote(s, original.voucherId, 40000)).not.toThrow(); // 47,200 fits (total 1,18,000)
    expect(() => creditNote(s, original.voucherId, 100)).toThrow(/in full|more than the bill/);
  });

  it('must refer to a sale, and a sale return and a credit note together cannot exceed the bill', () => {
    const s = seedShop();
    const original = sale(s);
    postVoucher(s.db, {
      type: 'sales_return',
      seriesId: s.seriesId.sales_return,
      date: '2026-10-09',
      partyAccountId: s.partyB,
      refVoucherId: original.voucherId,
      taxMode: 'local',
      roundOff: false,
      lines: [{ itemId: 1, qty: 9000, unitId: 1, listPricePaise: 10000 }], // 1,06,200 of 1,18,000
    });
    expect(() => creditNote(s, original.voucherId, 20000)).toThrow(/more than the bill itself/);
  });

  it('prints as a credit note with the original bill, and a value line without a quantity', () => {
    const s = seedShop();
    const original = sale(s);
    const note = creditNote(s, original.voucherId, 5000);
    const html = renderDocument(
      getVoucherDetail(s.db, note.voucherId)!,
      {
        name: 'Shop',
        address: '',
        gstin: '33AAPFU0939F1Z2',
        stateCode: '33',
        phone: null,
        invoiceFooter: '',
      },
      'a4',
    );
    expect(html).toContain('CREDIT NOTE');
    expect(html).toContain('Against bill');
    expect(html).toContain('Rate difference agreed with the customer');
  });
});

describe('debit note', () => {
  it('reduces what is owed to the supplier and the input tax claimed', () => {
    const s = seedShop();
    const bill = postVoucher(s.db, {
      type: 'purchase',
      seriesId: s.seriesId.purchase,
      date: '2026-10-05',
      partyAccountId: s.partyB,
      taxMode: 'local',
      roundOff: false,
      lines: [{ itemId: 1, qty: 10000, unitId: 1, listPricePaise: 8000 }], // taxable 800.00
    });
    postVoucher(s.db, {
      type: 'debit_note',
      seriesId: s.seriesId.debit_note,
      date: '2026-10-09',
      partyAccountId: s.partyB,
      refVoucherId: bill.voucherId,
      taxMode: 'local',
      roundOff: false,
      narration: 'Rate difference on supplier invoice',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 10000 }], // 100.00 + 18.00
    });
    expect(gstSummary(s.db, P).input).toEqual([
      { rateBp: 1800, taxablePaise: 70000, cgstPaise: 6300, sgstPaise: 6300, igstPaise: 0 },
    ]);
    expect(gstr3b(s.db, P).itc).toEqual({ igstPaise: 0, cgstPaise: 6300, sgstPaise: 6300 });
    expect(purchaseRegister(s.db, P).totals.taxablePaise).toBe(70000);
    const tb = trialBalance(s.db, { from: '2026-04-01', to: '2027-03-31' });
    expect(tb.totalDrPaise).toBe(tb.totalCrPaise);
    expect(
      count(s.db, 'SELECT COUNT(*) AS n FROM stock_movement WHERE voucher_id <> ?', bill.voucherId),
    ).toBe(0);
  });
});
