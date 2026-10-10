import type { Company } from '../users/company.ts';
import { showDate } from '../dates.ts';
import { esc, inr, type PaperSize } from './invoice.ts';

const CSS = (size: PaperSize) => `
@page { size: ${size === 'a4' ? 'A4' : '80mm auto'}; margin: ${size === 'a4' ? '10mm' : '3mm'}; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; }
.page { border: 2px solid #000; padding: ${size === 'a4' ? '8mm' : '2mm'}; }
h1 { font-size: ${size === 'a4' ? '20pt' : '13pt'}; margin: 0 0 2mm; text-align: center; }
h2 { font-size: ${size === 'a4' ? '14pt' : '11pt'}; margin: 0 0 4mm; text-align: center; }
p { margin: 0 0 2mm; font-size: ${size === 'a4' ? '11pt' : '9pt'}; }
.small { font-size: ${size === 'a4' ? '8pt' : '7pt'}; }
.big { font-size: ${size === 'a4' ? '16pt' : '12pt'}; font-weight: bold; }
.ruler { display: flex; border-top: 1px solid #000; margin: 3mm 0; }
.ruler span { flex: 1; border-left: 1px solid #000; height: 3mm; font-size: 6pt; }
.ruler span:last-child { border-right: 1px solid #000; }
`;

/**
 * A one-page printer check: the shop heading, the rupee sign, small and large text, and a border
 * round the printable area so cut-off edges are easy to see. It is not a bill and is not saved.
 */
export function testPageHtml(
  company: Company,
  size: PaperSize,
  stamp: { date: string; time: string },
): string {
  const marks = Array.from({ length: size === 'a4' ? 10 : 7 }, (_, i) => `<span>${i + 1}</span>`);
  const body = `<div class="page">
<h1>${esc(company.name)}</h1>
<h2>PRINTER TEST PAGE</h2>
<p>Printed on ${esc(showDate(stamp.date))} at ${esc(stamp.time.slice(0, 5))}, on ${size === 'a4' ? 'A4 paper' : 'the 80 mm receipt roll'}.</p>
<p>This is not a bill. Nothing has been saved in the accounts.</p>
<div class="ruler">${marks.join('')}</div>
<p class="big">Rupee sign and amount: ₹ ${esc(inr(123450))}</p>
<p>Normal text: Cement 50 kg bag, PVC pipe 1 inch, 2.5 sq mm wire.</p>
<p class="small">Small text, as used for HSN codes and tax lines: HSN 3917, CGST 9%, SGST 9%.</p>
<p>The test passes when the black border shows on all four sides and every line above can be read.</p>
</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Printer test page</title><style>${CSS(size)}</style></head><body>${body}</body></html>`;
}
