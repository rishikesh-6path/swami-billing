import {
  ValidationError,
  getCompany,
  getSetting,
  getVoucherDetail,
  renderDocument,
} from '@shopledger/core';
import type { HandlerContext, Handlers } from '../ipc.ts';

const PRINTABLE = [
  'sales',
  'sales_return',
  'purchase',
  'purchase_return',
  'receipt',
  'payment',
  'credit_note',
  'debit_note',
];

function page(ctx: HandlerContext, id: number, size: 'a4' | 'thermal') {
  const detail = getVoucherDetail(ctx.db, id);
  if (!detail) throw new ValidationError('That bill could not be found.');
  if (!PRINTABLE.includes(detail.voucherType)) {
    throw new ValidationError(
      'This kind of entry has no printout. Use the Day Book or the ledger instead.',
    );
  }
  const company = getCompany(ctx.db);
  if (!company) throw new ValidationError("Please enter your shop's details in Settings first.");
  const label = `${detail.voucherType.replace('_', '-')}-${detail.displayNumber}`.replace(
    /[^A-Za-z0-9._-]+/g,
    '-',
  );
  return { html: renderDocument(detail, company, size), label };
}

export const printHandlers: Pick<Handlers, 'print.preview' | 'print.run' | 'print.pdf'> = {
  'print.preview': (req, ctx) => {
    const { html, label } = page(ctx, req.id, req.size);
    return { html, title: label };
  },
  'print.run': async (req, ctx) => {
    const { html } = page(ctx, req.id, req.size);
    const printerName = getSetting(ctx.db, 'print.printer');
    return {
      printed: await ctx.printHtml(html, { size: req.size, printerName: printerName || undefined }),
    };
  },
  'print.pdf': async (req, ctx) => {
    const { html, label } = page(ctx, req.id, req.size);
    return { saved: await ctx.savePdf(html, { size: req.size, defaultName: `${label}.pdf` }) };
  },
};
