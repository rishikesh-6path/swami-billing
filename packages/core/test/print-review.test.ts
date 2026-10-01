import { describe, expect, it } from 'vitest';
import { postVoucher } from '../src/domain/posting/post.ts';
import { getVoucherDetail } from '../src/domain/posting/detail.ts';
import { renderDocument } from '../src/print/invoice.ts';
import { seedShop, type Shop } from './helpers/shop.ts';

const company = {
  name: 'Swami Hardware',
  address: '12 Main Road, Kuttalam',
  gstin: '33AAPFU0939F1Z2',
  stateCode: '33',
  phone: null,
  invoiceFooter: '',
};

const sale = (s: Shop, over: object = {}) =>
  postVoucher(s.db, {
    type: 'sales',
    seriesId: s.seriesId.sales,
    date: '2026-10-05',
    partyAccountId: s.partyA,
    taxMode: 'local',
    roundOff: false,
    lines: [{ itemId: 1, qty: 2000, unitId: 1, listPricePaise: 4500 }],
    ...over,
  });

const render = (s: Shop, id: number, size: 'a4' | 'thermal') =>
  renderDocument(getVoucherDetail(s.db, id)!, company, size);

describe('print review defects', () => {
  it('an exempt (nil-tax) sale by a registered shop is a Bill of Supply, not a Tax Invoice', () => {
    const s = seedShop();
    const { voucherId } = sale(s, { taxMode: 'exempt' });
    const html = render(s, voucherId, 'a4');
    expect(html).toContain('BILL OF SUPPLY');
    expect(html).not.toContain('TAX INVOICE');
  });

  it('an interstate bill whose IGST rounds to nil is still shown as IGST, not CGST/SGST', () => {
    const s = seedShop();
    // taxable 2 paise at 18% -> IGST 0.36 paise rounds to 0
    const { voucherId } = sale(s, {
      taxMode: 'interstate',
      lines: [{ itemId: 1, qty: 1000, unitId: 1, listPricePaise: 2 }],
    });
    const html = render(s, voucherId, 'a4');
    expect(html).toContain('IGST');
    expect(html).not.toContain('<th class="n">CGST</th>');
  });

  it('a thermal interstate bill states the place of supply', () => {
    const s = seedShop();
    const { voucherId } = sale(s, { taxMode: 'interstate' });
    expect(render(s, voucherId, 'thermal')).toContain('Place of supply');
  });

  it('a thermal credit note names the original bill number and date (KICKOFF section 8)', () => {
    const s = seedShop();
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
    const html = render(s, note.voucherId, 'thermal');
    expect(html).toContain('CREDIT NOTE');
    expect(html).toContain('Against bill');
    expect(html).toContain('05-10-2026');
  });

  it('a thermal receipt shows its accounts and no bogus "Items total 0.00"', () => {
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
    const html = render(s, receipt.voucherId, 'thermal');
    expect(html).not.toContain('Items total');
  });

  it('a reprint does not pick up a GSTIN added to the customer after the bill was issued', () => {
    const s = seedShop();
    const { voucherId } = sale(s); // customer had no GSTIN: this was a B2C bill
    s.db.exec("UPDATE account SET gstin = '29ABCDE1234F1Z5' WHERE id = 11");
    const html = render(s, voucherId, 'a4');
    expect(html).not.toContain('29ABCDE1234F1Z5');
  });
});
