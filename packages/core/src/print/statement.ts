import type { Db } from '../db/connection.ts';
import { showDate } from '../dates.ts';
import { VOUCHER_TYPE_LABELS } from '../masters/setup.ts';
import { accountLedger } from '../reports/ledger.ts';
import { outstanding } from '../reports/outstanding.ts';
import { partySummary } from '../reports/party-summary.ts';
import type { Company } from '../users/company.ts';
import { amountInWords } from './words.ts';
import { CSS_A4, esc, inr } from './invoice.ts';

const STATEMENT_CSS = `${CSS_A4}
.balance { font-size: 15px; font-weight: 700; margin-top: 8px; text-align: right; }
.ageing td, .ageing th { text-align: right; }
`;

/** Debit or credit balance, in the words a customer or supplier understands. */
function balanceWords(kind: 'customer' | 'supplier', signed: number): string {
  if (signed === 0) return 'Nothing is due';
  const owedToShop = signed > 0;
  if (kind === 'customer') return owedToShop ? 'Amount due' : 'Advance with us';
  return owedToShop ? 'Advance paid to you' : 'Amount we owe you';
}

/**
 * A statement of account to hand to a customer or send to a supplier: the shop's heading, their
 * details, the opening balance, every bill and payment in the period with a running balance, the
 * balance at the end in words, and how old the unpaid bills are.
 */
export function renderStatement(
  db: Db,
  args: { partyId: number; from: string; to: string },
  company: Company,
): { html: string; closingPaise: number; partyName: string } {
  const party = partySummary(db, args.partyId, args.to);
  const ledger = accountLedger(db, { accountId: args.partyId, from: args.from, to: args.to });
  const side = party.kind === 'customer' ? 'receivable' : 'payable';
  const open = outstanding(db, { asOn: args.to, side, accountId: args.partyId })[0];
  const label = (type: string) => (VOUCHER_TYPE_LABELS as Record<string, string>)[type] ?? type;
  const money = (p: number) => (p === 0 ? '' : inr(p));
  const bal = (signed: number) => `${inr(Math.abs(signed))} ${signed >= 0 ? 'Dr' : 'Cr'}`;
  const closing = ledger.closingPaise;
  const rows = ledger.rows
    .map(
      (r) =>
        `<tr><td>${esc(showDate(r.date))}</td><td>${esc(label(r.voucherType))} ${esc(r.displayNumber)}</td><td>${esc(r.particulars)}</td><td class="n">${money(r.drPaise)}</td><td class="n">${money(r.crPaise)}</td><td class="n">${bal(r.balancePaise)}</td></tr>`,
    )
    .join('\n');
  const ageing =
    open && open.outstandingPaise > 0
      ? `<h3>Unpaid bills by age</h3>
<table class="ageing"><thead><tr><th>Up to 30 days</th><th>31 to 60 days</th><th>61 to 90 days</th><th>Over 90 days</th><th>Total</th></tr></thead>
<tbody><tr><td>${inr(open.buckets.upTo30)}</td><td>${inr(open.buckets.upTo60)}</td><td>${inr(open.buckets.upTo90)}</td><td>${inr(open.buckets.over90)}</td><td>${inr(open.outstandingPaise)}</td></tr></tbody></table>`
      : '';
  const details = [
    esc(party.name),
    party.address ? esc(party.address) : '',
    party.phone ? `Phone: ${esc(party.phone)}` : '',
    party.gstin ? `GSTIN: ${esc(party.gstin)}` : '',
  ]
    .filter(Boolean)
    .join('<br>');
  const words = balanceWords(party.kind, closing);
  const body = `<div class="sheet">
<div class="head"><h1>${esc(company.name)}</h1>
<div>${esc(company.address)}</div>
<div>${company.phone ? `Phone: ${esc(company.phone)}` : ''}${company.gstin ? ` &nbsp; GSTIN: ${esc(company.gstin)}` : ''}</div></div>
<div class="title">STATEMENT OF ACCOUNT</div>
<div class="cols">
<div><h3>${party.kind === 'customer' ? 'Customer' : 'Supplier'}</h3>${details}</div>
<div><h3>Period</h3>${esc(showDate(args.from))} to ${esc(showDate(args.to))}</div>
</div>
<table><thead><tr><th>Date</th><th>Bill or entry</th><th>Details</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr></thead>
<tbody>
<tr><td>${esc(showDate(args.from))}</td><td colspan="4">Balance at the start</td><td class="n">${bal(ledger.openingPaise)}</td></tr>
${rows}
<tr><td></td><td colspan="2"><b>Total</b></td><td class="n"><b>${inr(ledger.totalDrPaise)}</b></td><td class="n"><b>${inr(ledger.totalCrPaise)}</b></td><td class="n"><b>${bal(closing)}</b></td></tr>
</tbody></table>
<div class="balance">${esc(words)}${closing === 0 ? '' : `: ₹ ${inr(Math.abs(closing))}`}</div>
${closing === 0 ? '' : `<div class="words">${esc(amountInWords(Math.abs(closing)))}</div>`}
${ageing}
<div class="foot"><div class="muted">${esc(company.invoiceFooter)}</div><div class="sign">For ${esc(company.name)}</div></div>
</div>`;
  return {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Statement ${esc(party.name)}</title><style>${STATEMENT_CSS}</style></head><body>${body}</body></html>`,
    closingPaise: closing,
    partyName: party.name,
  };
}
