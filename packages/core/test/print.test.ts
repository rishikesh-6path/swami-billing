import { describe, expect, it } from 'vitest';
import { cancelVoucher, postVoucher } from '../src/domain/posting/post.ts';
import { getVoucherDetail } from '../src/domain/posting/detail.ts';
import { esc, inr, renderDocument } from '../src/print/invoice.ts';
import { amountInWords } from '../src/print/words.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

const company = {
  name: 'Swami Hardware & Co',
  address: '12 Main Road, Kuttalam',
  gstin: '33AAPFU0939F1Z2',
  stateCode: '33',
  phone: '9840012345',
  invoiceFooter: 'Goods once sold will not be taken back.',
};

const sale = (s: Shop, over: object = {}) =>
  postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date: '2026-10-05',
    partyAccountId: s.partyA,
    taxMode: 'local',
    roundOff: false,
    lines: [
      { itemId: 1, qty: 2000, unitId: 1, listPricePaise: 4500 },
      { itemId: 3, qty: 1000, unitId: 1, listPricePaise: 10000 },
    ],
    sundries: [{ billSundryId: s.sundry.freight, amountPaise: 500 }],
    settlements: [{ accountId: s.cash, amountPaise: 1000 }],
    narration: 'Being goods sold',
    ...over,
  });

describe('amountInWords', () => {
  it('uses the Indian system with lakh and crore', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only');
    expect(amountInWords(11805)).toBe('Rupees One Hundred Eighteen and Five Paise Only');
    expect(amountInWords(118050)).toBe(
      'Rupees One Thousand One Hundred Eighty and Fifty Paise Only',
    );
    expect(amountInWords(12_345_678_00)).toBe(
      'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only',
    );
    expect(amountInWords(100_000_00)).toBe('Rupees One Lakh Only');
  });
  it('rejects negative or fractional paise', () => {
    expect(() => amountInWords(-1)).toThrow(RangeError);
    expect(() => amountInWords(1.5)).toThrow(RangeError);
  });
});

describe('formatting', () => {
  it('groups digits the Indian way and escapes HTML', () => {
    expect(inr(123456789)).toBe('12,34,567.89');
    expect(inr(-5)).toBe('-0.05');
    expect(esc('<b>"A" & \'B\'</b>')).toBe('&lt;b&gt;&quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;');
  });
});

describe('renderDocument', () => {
  it('prints every mandatory GST field on an A4 tax invoice', () => {
    const s = seedShop();
    s.db.exec(
      "UPDATE account SET gstin = '33AAPFU0939F1Z2', state_code = '33', address = '5 Temple St' WHERE id = 11",
    );
    const html = renderDocument(getVoucherDetail(s.db, sale(s).voucherId)!, company, 'a4');
    for (const needed of [
      'TAX INVOICE',
      'Swami Hardware &amp; Co',
      '12 Main Road, Kuttalam',
      'GSTIN: 33AAPFU0939F1Z2',
      'AYAPPAN PIPE KUTTALAM',
      '5 Temple St',
      'Place of supply: 33-Tamil Nadu',
      '73079990', // HSN
      '4901', // HSN of the second item
      'CGST',
      'SGST',
      '9% = ',
      'Authorised signatory',
      'Goods once sold will not be taken back.',
      'Rupees ',
      '<b>05-10-2026</b>',
    ]) {
      expect(html).toContain(needed);
    }
    // 2 x 45.00 = 90.00 at 18%, 100.00 at 5%, freight 5.00 spread before tax; total tax is shown rate by rate
    expect(html).toMatch(/18%/);
    expect(html).toMatch(/5%/);
    expect(html).toContain('Items total');
    expect(html).toContain('Freight &amp; Forwarding');
    expect(html).toContain('Paid in Cash');
  });

  it('shows IGST for interstate bills and a Bill of Supply for a shop without GSTIN', () => {
    const s = seedShop();
    const inter = renderDocument(
      getVoucherDetail(s.db, sale(s, { taxMode: 'interstate' }).voucherId)!,
      company,
      'a4',
    );
    expect(inter).toContain('IGST');
    expect(inter).not.toContain('<th class="n">CGST</th>');
    const local = renderDocument(
      getVoucherDetail(s.db, sale(s).voucherId)!,
      { ...company, gstin: null },
      'a4',
    );
    expect(local).toContain('BILL OF SUPPLY');
    expect(local).not.toContain('GSTIN: 33AAPFU');
  });

  it('never lets database text break out of the page', () => {
    const s = seedShop();
    s.db.exec("UPDATE item SET name = '<script>alert(1)</script>' WHERE id = 1");
    const html = renderDocument(
      getVoucherDetail(s.db, sale(s, { narration: '<img src=x onerror=alert(1)>' }).voucherId)!,
      company,
      'a4',
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('marks a cancelled bill and renders a narrow thermal receipt', () => {
    const s = seedShop();
    const id = sale(s).voucherId;
    cancelVoucher(s.db, id);
    const detail = getVoucherDetail(s.db, id)!;
    expect(renderDocument(detail, company, 'a4')).toContain('CANCELLED');
    const thermal = renderDocument(detail, company, 'thermal');
    expect(thermal).toContain('size: 80mm auto');
    expect(thermal).toContain('*** CANCELLED ***');
    expect(thermal).toContain('TOTAL');
  });

  it('prints receipts and credit notes with the right titles', () => {
    const s = seedShop();
    const receipt = postVoucher(s.db, {
      type: 'receipt',
      seriesId: s.seriesId.receipt,
      date: '2026-10-05',
      partyAccountId: s.partyA,
      entries: [
        { accountId: s.cash, side: 'dr', amountPaise: 50000 },
        { accountId: s.partyA, side: 'cr', amountPaise: 50000 },
      ],
    });
    const html = renderDocument(getVoucherDetail(s.db, receipt.voucherId)!, company, 'a4');
    expect(html).toContain('RECEIPT');
    expect(html).toContain('Rupees Five Hundred Only');
    const original = sale(s).voucherId;
    const note = postVoucher(s.db, {
      type: 'sales_return',
      seriesId: s.seriesId.sales_return,
      date: '2026-10-06',
      partyAccountId: s.partyA,
      refVoucherId: original,
      taxMode: 'local',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 4500 }],
    });
    const noteHtml = renderDocument(getVoucherDetail(s.db, note.voucherId)!, company, 'a4');
    expect(noteHtml).toContain('CREDIT NOTE');
    expect(noteHtml).toContain('Against bill: ');
  });
});
