import type { VoucherDetail } from '../domain/posting/detail.ts';
import { STATE_NAMES } from '../reports/gst/common.ts';
import type { Company } from '../users/company.ts';
import { amountInWords } from './words.ts';

export type PaperSize = 'a4' | 'thermal';

/** Escapes text for safe use inside HTML. Everything that comes from the database goes through this. */
export function esc(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function groupIndian(whole: string): string {
  if (whole.length <= 3) return whole;
  return `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}`;
}

/** 118050 -> "1,180.50" */
export function inr(paise: number): string {
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  return `${paise < 0 ? '-' : ''}${groupIndian(String(whole))}.${String(abs - whole * 100).padStart(2, '0')}`;
}

const qty = (milli: number): string => {
  const whole = Math.floor(Math.abs(milli) / 1000);
  const frac = String(Math.abs(milli) - whole * 1000)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return `${milli < 0 ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
};

const pct = (bp: number): string =>
  `${bp % 100 === 0 ? bp / 100 : (bp / 100).toFixed(2).replace(/0$/, '')}%`;
const dmy = (iso: string): string => iso.split('-').reverse().join('-');
const place = (code: string | null): string => (code ? `${code}-${STATE_NAMES[code] ?? ''}` : '');

function titleOf(detail: VoucherDetail, company: Company): string {
  switch (detail.voucherType) {
    case 'sales':
      return company.gstin ? 'TAX INVOICE' : 'BILL OF SUPPLY';
    case 'sales_return':
      return 'CREDIT NOTE';
    case 'purchase':
      return 'PURCHASE BILL';
    case 'purchase_return':
      return 'PURCHASE RETURN';
    case 'receipt':
      return 'RECEIPT';
    case 'payment':
      return 'PAYMENT VOUCHER';
    default:
      return 'VOUCHER';
  }
}

interface TaxRow {
  rateBp: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}

function taxSummary(detail: VoucherDetail): TaxRow[] {
  const map = new Map<number, TaxRow>();
  for (const l of detail.lines) {
    const row = map.get(l.taxRateBp) ?? {
      rateBp: l.taxRateBp,
      taxable: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
    };
    row.taxable += l.taxablePaise;
    row.cgst += l.cgstPaise;
    row.sgst += l.sgstPaise;
    row.igst += l.igstPaise;
    map.set(l.taxRateBp, row);
  }
  return [...map.values()].sort((a, b) => a.rateBp - b.rateBp);
}

const isItemBill = (d: VoucherDetail) => d.lines.length > 0;

const CSS_A4 = `
@page { size: A4; margin: 10mm; }
* { box-sizing: border-box; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 12px; color: #111; margin: 0; }
.sheet { position: relative; }
h1 { font-size: 20px; margin: 0; }
.head { text-align: center; border-bottom: 2px solid #111; padding-bottom: 6px; }
.title { text-align: center; font-weight: 700; letter-spacing: 1px; margin: 6px 0; font-size: 14px; }
.cols { display: flex; gap: 12px; margin-bottom: 8px; }
.cols > div { flex: 1; border: 1px solid #999; padding: 6px 8px; }
.cols h3 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; color: #555; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #999; padding: 3px 5px; }
th { background: #eee; text-align: left; font-size: 11px; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
.summary { display: flex; gap: 12px; margin-top: 8px; align-items: flex-start; }
.summary .tax { flex: 1.4; }
.summary .tot { flex: 1; }
.tot td { border: none; padding: 2px 4px; }
.tot tr.grand td { font-size: 15px; font-weight: 700; border-top: 2px solid #111; }
.words { margin-top: 6px; font-style: italic; }
.foot { margin-top: 10px; display: flex; justify-content: space-between; gap: 20px; }
.sign { margin-top: 36px; text-align: right; }
.watermark { position: absolute; top: 35%; left: 10%; font-size: 90px; color: rgba(200,0,0,.18); transform: rotate(-20deg); font-weight: 700; }
.muted { color: #555; }
`;

const CSS_THERMAL = `
@page { size: 80mm auto; margin: 3mm; }
* { box-sizing: border-box; }
body { font-family: 'Courier New', monospace; font-size: 11px; width: 72mm; margin: 0; color: #000; }
.c { text-align: center; }
.b { font-weight: 700; }
hr { border: none; border-top: 1px dashed #000; margin: 4px 0; }
.row { display: flex; justify-content: space-between; gap: 6px; }
.big { font-size: 14px; font-weight: 700; }
.watermark { text-align: center; font-weight: 700; font-size: 16px; }
`;

function partyBlock(d: VoucherDetail): string {
  if (!d.party) return '';
  const p = d.party;
  return [
    esc(p.name),
    p.address ? esc(p.address) : '',
    p.phone ? `Phone: ${esc(p.phone)}` : '',
    p.gstin ? `GSTIN: ${esc(p.gstin)}` : '',
    p.stateCode ? `State: ${esc(place(p.stateCode))}` : '',
  ]
    .filter(Boolean)
    .join('<br>');
}

function renderA4(d: VoucherDetail, c: Company): string {
  const interstate = d.lines.some((l) => l.igstPaise > 0);
  const tax = taxSummary(d);
  const itemsTable = isItemBill(d)
    ? `<table><thead><tr><th>#</th><th>Description</th><th>HSN</th><th class="n">Qty</th><th>Unit</th><th class="n">Rate</th><th class="n">Disc %</th><th class="n">Taxable value</th><th class="n">GST %</th><th class="n">GST amount</th><th class="n">Amount</th></tr></thead><tbody>
${d.lines
  .map(
    (l) =>
      `<tr><td>${l.lineNo}</td><td>${esc(l.itemName)}</td><td>${esc(l.hsn)}</td><td class="n">${qty(l.qty)}</td><td>${esc(l.unitName)}</td><td class="n">${inr(l.listPricePaise)}</td><td class="n">${l.discBp ? pct(l.discBp) : ''}</td><td class="n">${inr(l.taxablePaise)}</td><td class="n">${l.taxRateBp ? pct(l.taxRateBp) : ''}</td><td class="n">${inr(l.cgstPaise + l.sgstPaise + l.igstPaise)}</td><td class="n">${inr(l.taxablePaise + l.cgstPaise + l.sgstPaise + l.igstPaise)}</td></tr>`,
  )
  .join('\n')}
</tbody></table>`
    : d.entries.length > 0
      ? `<table><thead><tr><th>Account</th><th class="n">Debit</th><th class="n">Credit</th></tr></thead><tbody>${d.entries.map((e) => `<tr><td>${esc(e.accountName)}</td><td class="n">${e.side === 'dr' ? inr(e.amountPaise) : ''}</td><td class="n">${e.side === 'cr' ? inr(e.amountPaise) : ''}</td></tr>`).join('')}</tbody></table>`
      : '';

  const taxTable =
    isItemBill(d) && tax.some((t) => t.rateBp > 0)
      ? `<table class="tax"><thead><tr><th>GST rate</th><th class="n">Taxable value</th>${interstate ? '<th class="n">IGST</th>' : '<th class="n">CGST</th><th class="n">SGST</th>'}<th class="n">Total tax</th></tr></thead><tbody>
${tax
  .filter((t) => t.rateBp > 0)
  .map((t) =>
    interstate
      ? `<tr><td>${pct(t.rateBp)}</td><td class="n">${inr(t.taxable)}</td><td class="n">${pct(t.rateBp)} = ${inr(t.igst)}</td><td class="n">${inr(t.igst)}</td></tr>`
      : `<tr><td>${pct(t.rateBp)}</td><td class="n">${inr(t.taxable)}</td><td class="n">${pct(t.rateBp / 2)} = ${inr(t.cgst)}</td><td class="n">${pct(t.rateBp / 2)} = ${inr(t.sgst)}</td><td class="n">${inr(t.cgst + t.sgst)}</td></tr>`,
  )
  .join('\n')}
</tbody></table>`
      : '<div></div>';

  const totals = isItemBill(d)
    ? `<tr><td>Items total</td><td class="n">${inr(d.subtotalPaise)}</td></tr>
${d.sundries.map((s) => `<tr><td>${esc(s.name)}</td><td class="n">${inr(s.sign * s.amountPaise)}</td></tr>`).join('')}
<tr><td>GST</td><td class="n">${inr(d.taxPaise)}</td></tr>
${d.roundOffPaise ? `<tr><td>Round off</td><td class="n">${inr(d.roundOffPaise)}</td></tr>` : ''}`
    : '';

  return `<div class="sheet">
${d.status === 'cancelled' ? '<div class="watermark">CANCELLED</div>' : ''}
<div class="head"><h1>${esc(c.name)}</h1>
<div>${esc(c.address)}</div>
<div>${c.phone ? `Phone: ${esc(c.phone)}` : ''}${c.gstin ? ` &nbsp; GSTIN: ${esc(c.gstin)}` : ''}${c.stateCode ? ` &nbsp; State: ${esc(place(c.stateCode))}` : ''}</div></div>
<div class="title">${esc(titleOf(d, c))}</div>
<div class="cols">
<div><h3>${d.voucherType === 'purchase' || d.voucherType === 'purchase_return' || d.voucherType === 'payment' ? 'Supplier' : 'Bill to'}</h3>${partyBlock(d)}</div>
<div><h3>Details</h3>
No.: <b>${esc(d.displayNumber)}</b><br>Date: <b>${esc(dmy(d.date))}</b>
${d.posStateCode ? `<br>Place of supply: ${esc(place(d.posStateCode))}` : ''}
${d.refVoucher ? `<br>Against bill: ${esc(d.refVoucher.displayNumber)} dated ${esc(dmy(d.refVoucher.date))}` : ''}
${d.saleTypeName ? `<br>Type: ${esc(d.saleTypeName)}` : ''}</div>
</div>
${itemsTable}
<div class="summary">${taxTable}<table class="tot"><tbody>${totals}<tr class="grand"><td>Total</td><td class="n">${inr(d.totalPaise)}</td></tr>${d.settlements.map((s) => `<tr><td>Paid in ${esc(s.accountName)}</td><td class="n">${inr(s.amountPaise)}</td></tr>`).join('')}</tbody></table></div>
<div class="words">${esc(amountInWords(d.totalPaise))}</div>
${d.narration ? `<div class="muted">${esc(d.narration)}</div>` : ''}
<div class="foot"><div class="muted">${esc(c.invoiceFooter)}</div><div class="sign">For ${esc(c.name)}<br><br><br>Authorised signatory</div></div>
<div class="muted">Customer signature: ________________</div>
</div>`;
}

function renderThermal(d: VoucherDetail, c: Company): string {
  const tax = taxSummary(d).filter((t) => t.rateBp > 0);
  const interstate = d.lines.some((l) => l.igstPaise > 0);
  return `<div class="c b big">${esc(c.name)}</div>
<div class="c">${esc(c.address)}</div>
${c.phone ? `<div class="c">Phone: ${esc(c.phone)}</div>` : ''}${c.gstin ? `<div class="c">GSTIN: ${esc(c.gstin)}</div>` : ''}
<hr><div class="c b">${esc(titleOf(d, c))}</div>
${d.status === 'cancelled' ? '<div class="watermark">*** CANCELLED ***</div>' : ''}
<div class="row"><span>No: ${esc(d.displayNumber)}</span><span>${esc(dmy(d.date))}</span></div>
${d.party ? `<div>${esc(d.party.name)}${d.party.gstin ? `<br>GSTIN: ${esc(d.party.gstin)}` : ''}</div>` : ''}
<hr>
${d.lines
  .map(
    (l) =>
      `<div>${esc(l.itemName)}${l.hsn ? ` (${esc(l.hsn)})` : ''}</div><div class="row"><span>${qty(l.qty)} ${esc(l.unitName)} x ${inr(l.listPricePaise)}${l.discBp ? ` -${pct(l.discBp)}` : ''}</span><span>${inr(l.taxablePaise)}</span></div>`,
  )
  .join('\n')}
<hr>
<div class="row"><span>Items total</span><span>${inr(d.subtotalPaise)}</span></div>
${d.sundries.map((s) => `<div class="row"><span>${esc(s.name)}</span><span>${inr(s.sign * s.amountPaise)}</span></div>`).join('')}
${tax
  .map((t) =>
    interstate
      ? `<div class="row"><span>IGST ${pct(t.rateBp)} on ${inr(t.taxable)}</span><span>${inr(t.igst)}</span></div>`
      : `<div class="row"><span>CGST ${pct(t.rateBp / 2)} on ${inr(t.taxable)}</span><span>${inr(t.cgst)}</span></div><div class="row"><span>SGST ${pct(t.rateBp / 2)}</span><span>${inr(t.sgst)}</span></div>`,
  )
  .join('')}
${d.roundOffPaise ? `<div class="row"><span>Round off</span><span>${inr(d.roundOffPaise)}</span></div>` : ''}
<hr><div class="row big"><span>TOTAL</span><span>${inr(d.totalPaise)}</span></div>
${d.settlements.map((s) => `<div class="row"><span>Paid in ${esc(s.accountName)}</span><span>${inr(s.amountPaise)}</span></div>`).join('')}
<div>${esc(amountInWords(d.totalPaise))}</div>
<hr><div class="c">${esc(c.invoiceFooter)}</div>`;
}

/**
 * A complete HTML page for a bill, ready to print on A4 paper or an 80 mm thermal roll. Item bills
 * carry every field a GST invoice needs: the shop's name, address and GSTIN, the bill number and
 * date, the customer, place of supply, HSN, quantity, rate, taxable value, rate-wise CGST/SGST or
 * IGST, the total in figures and words, and a signature block.
 */
export function renderDocument(detail: VoucherDetail, company: Company, size: PaperSize): string {
  const body = size === 'a4' ? renderA4(detail, company) : renderThermal(detail, company);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(titleOf(detail, company))} ${esc(detail.displayNumber)}</title><style>${size === 'a4' ? CSS_A4 : CSS_THERMAL}</style></head><body>${body}</body></html>`;
}
