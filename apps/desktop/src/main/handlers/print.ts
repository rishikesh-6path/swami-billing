import {
  ValidationError,
  getCompany,
  getSetting,
  getVoucherDetail,
  renderDocument,
  renderEstimate,
  renderStatement,
  type ItemVoucherInput,
  labelItems,
  labelsHtml,
  type LabelLayout,
} from '@shopledger/core';
import type { z } from 'zod';
import type { itemVoucherDraft } from '../../ipc/contract.ts';
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

const labelSheet = (
  ctx: HandlerContext,
  req: { items: { itemId: number; count: number }[]; layout: LabelLayout },
) => labelsHtml(labelItems(ctx.db, req.items, ctx.today()), req.layout);

/** A statement of account for a customer or supplier over a period. */
function statementPage(ctx: HandlerContext, req: { partyId: number; from: string; to: string }) {
  const company = getCompany(ctx.db);
  if (!company) throw new ValidationError("Please enter your shop's details in Settings first.");
  if (req.from > req.to) throw new ValidationError('The first date is after the last date.');
  return renderStatement(ctx.db, req, company);
}

/** The estimate of a sale still on the screen; the draft becomes a bill only when it is saved. */
function estimatePage(
  ctx: HandlerContext,
  req: { draft: z.infer<typeof itemVoucherDraft>; size: 'a4' | 'thermal' },
  record: boolean,
) {
  const company = getCompany(ctx.db);
  if (!company) throw new ValidationError("Please enter your shop's details in Settings first.");
  if (req.draft.type !== 'sales') throw new ValidationError('Estimates are made from a sale.');
  const cash = ctx.db.prepare("SELECT id FROM account WHERE name = 'Cash' AND is_system = 1").get();
  const draft = {
    ...req.draft,
    seriesId: req.draft.seriesId ?? 0,
    partyAccountId: req.draft.partyAccountId ?? Number(cash?.['id']),
  } as ItemVoucherInput;
  return renderEstimate(
    ctx.db,
    draft,
    company,
    req.size,
    record ? { userId: ctx.user().id } : undefined,
  );
}

export const printHandlers: Pick<
  Handlers,
  | 'print.preview'
  | 'print.run'
  | 'print.pdf'
  | 'labels.preview'
  | 'labels.print'
  | 'labels.pdf'
  | 'estimate.preview'
  | 'estimate.print'
  | 'estimate.pdf'
  | 'statement.preview'
  | 'statement.print'
  | 'statement.pdf'
> = {
  'statement.preview': (req, ctx) => ({ html: statementPage(ctx, req).html }),
  'statement.print': async (req, ctx) => {
    const { html } = statementPage(ctx, req);
    return { printed: await ctx.printHtml(html, { size: 'a4' }) };
  },
  'statement.pdf': async (req, ctx) => {
    const { html, partyName } = statementPage(ctx, req);
    const name = partyName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'party';
    return {
      saved: await ctx.savePdf(html, {
        size: 'a4',
        defaultName: `statement-${name}-${req.to}.pdf`,
      }),
    };
  },
  'estimate.preview': (req, ctx) => estimatePage(ctx, req, false),
  'estimate.print': async (req, ctx) => {
    const { html } = estimatePage(ctx, req, true);
    // through the print window, so the person can choose the paper and copies
    return { printed: await ctx.printHtml(html, { size: req.size }) };
  },
  'estimate.pdf': async (req, ctx) => {
    const { html } = estimatePage(ctx, req, true);
    return {
      saved: await ctx.savePdf(html, {
        size: req.size,
        defaultName: `estimate-${ctx.today()}.pdf`,
      }),
    };
  },
  'labels.preview': (req, ctx) => labelSheet(ctx, req),
  'labels.print': async (req, ctx) => {
    const { html } = labelSheet(ctx, req);
    // always through the print window: the printer set for bills is often an 80 mm receipt
    // printer, and label sheets may need another printer or the hand-feed tray
    return { printed: await ctx.printHtml(html, { size: 'a4' }) };
  },
  'labels.pdf': async (req, ctx) => {
    const { html } = labelSheet(ctx, req);
    return { saved: await ctx.savePdf(html, { size: 'a4', defaultName: 'labels.pdf' }) };
  },
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
