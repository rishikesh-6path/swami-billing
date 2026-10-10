import type { Company } from '../users/company.ts';
import { showDate } from '../dates.ts';
import { CSS_A4, CSS_THERMAL, esc, inr, type PaperSize } from './invoice.ts';

// the bill's own page size, width and font, plus a border and a ruler to show the edges
const EXTRA = `
.page { border: 2px solid #000; padding: 2mm; }
.ruler { display: flex; border-top: 1px solid #000; margin: 2mm 0; }
.ruler span { flex: 1; border-left: 1px solid #000; height: 3mm; font-size: 8px; }
.ruler span:last-child { border-right: 1px solid #000; }
.t { text-align: center; font-weight: 700; }
p { margin: 0 0 2mm; }
.small { font-size: 9px; }
`;

/**
 * A one-page printer check laid out exactly like a bill on the same paper (page size, width and
 * font), with a border round it so cut-off edges are easy to see. It is not a bill and is not
 * saved.
 */
export function testPageHtml(
  company: Company,
  size: PaperSize,
  stamp: { date: string; time: string },
): string {
  const marks = Array.from({ length: size === 'a4' ? 10 : 7 }, (_, i) => `<span>${i + 1}</span>`);
  const body = `<div class="page">
<p class="t">${esc(company.name)}</p>
<p class="t">PRINTER TEST PAGE</p>
<p>Printed on ${esc(showDate(stamp.date))} at ${esc(stamp.time.slice(0, 5))}, on ${size === 'a4' ? 'A4 paper' : 'the 80 mm receipt roll'}.</p>
<p>This is not a bill. Nothing has been saved in the accounts.</p>
<div class="ruler">${marks.join('')}</div>
<p>Amount as printed on a bill: ${esc(inr(123450))}</p>
<p>Cement 50 kg bag, PVC pipe 1 inch, 2.5 sq mm wire.</p>
<p class="small">Small text: HSN 3917, CGST 9%, SGST 9%.</p>
<p>The test passes when the black border shows on all four sides and every line can be read.</p>
</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Printer test page</title><style>${size === 'a4' ? CSS_A4 : CSS_THERMAL}${EXTRA}</style></head><body>${body}</body></html>`;
}
