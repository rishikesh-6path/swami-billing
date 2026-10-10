import {
  ValidationError,
  getCompany,
  getSetting,
  getVoucherDetail,
  renderDocument,
  recordEstimate,
  renderEstimate,
  renderStatement,
  testPageHtml,
  calibrationHtml,
  getLabelSettings,
  saveLabelSettings,
  type ItemVoucherInput,
  labelItems,
  labelsHtml,
  type LabelLayout,
} from '@shopledger/core';
import type { z } from 'zod';
import type { itemVoucherDraft } from '../../ipc/contract.ts';
import type { HandlerContext, Handlers } from '../ipc.ts';

/** The shop's heading for printouts; staff cannot fill it in, so the message says who can. */
function shopDetails(ctx: HandlerContext) {
  const company = getCompany(ctx.db);
  if (!company) {
    throw new ValidationError(
      "The shop's name and address have not been entered yet. The owner can enter them in Settings.",
    );
  }
  return company;
}

/** A name that is safe in a file name, keeping letters in any language. */
function fileWord(text: string, fallback: string): string {
  return text.replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || fallback;
}

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
  const company = shopDetails(ctx);
  const label = `${detail.voucherType.replace('_', '-')}-${detail.displayNumber}`.replace(
    /[^A-Za-z0-9._-]+/g,
    '-',
  );
  return { html: renderDocument(detail, company, size), label };
}

const labelSheet = (
  ctx: HandlerContext,
  req: { items: { itemId: number; count: number }[]; layout: LabelLayout },
) => labelsHtml(labelItems(ctx.db, req.items, ctx.today()), req.layout, getLabelSettings(ctx.db));

/** A statement of account for a customer or supplier over a period. */
function statementPage(ctx: HandlerContext, req: { partyId: number; from: string; to: string }) {
  const company = shopDetails(ctx);
  if (req.from > req.to) throw new ValidationError('The first date is after the last date.');
  return renderStatement(ctx.db, req, company);
}

/** The estimate of a sale still on the screen; the draft becomes a bill only when it is saved. */
function estimatePage(
  ctx: HandlerContext,
  req: { draft: z.infer<typeof itemVoucherDraft>; size: 'a4' | 'thermal' },
) {
  const company = shopDetails(ctx);
  if (req.draft.type !== 'sales') throw new ValidationError('Estimates are made from a sale.');
  const cash = ctx.db.prepare("SELECT id FROM account WHERE name = 'Cash' AND is_system = 1").get();
  const draft = {
    ...req.draft,
    seriesId: req.draft.seriesId ?? 0,
    partyAccountId: req.draft.partyAccountId ?? Number(cash?.['id']),
  } as ItemVoucherInput;
  return renderEstimate(ctx.db, draft, company, req.size);
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
  | 'labels.settings'
  | 'labels.saveSettings'
  | 'labels.calibrate'
  | 'selftest.print'
> = {
  'selftest.print': async (req, ctx) => {
    const clock = ctx.clock();
    const html = testPageHtml(shopDetails(ctx), req.size, clock);
    // the same printer the bills go to, so the test proves what billing will do
    const printerName = getSetting(ctx.db, 'print.printer');
    return {
      printed: await ctx.printHtml(html, { size: req.size, printerName: printerName || undefined }),
    };
  },
  'labels.settings': (_req, ctx) => getLabelSettings(ctx.db),
  'labels.saveSettings': (req, ctx) => {
    saveLabelSettings(ctx.db, req, { userId: ctx.user().id });
    return null;
  },
  'labels.calibrate': async (req, ctx) => {
    const html = calibrationHtml(req.layout, req);
    if (req.action === 'pdf') {
      return {
        printed: false,
        saved: await ctx.savePdf(html, { size: 'a4', defaultName: 'label-test-sheet.pdf' }),
      };
    }
    return { printed: await ctx.printHtml(html, { size: 'a4' }), saved: null };
  },
  'statement.preview': (req, ctx) => ({ html: statementPage(ctx, req).html }),
  'statement.print': async (req, ctx) => {
    const { html } = statementPage(ctx, req);
    return { printed: await ctx.printHtml(html, { size: 'a4' }) };
  },
  'statement.pdf': async (req, ctx) => {
    const { html, partyName } = statementPage(ctx, req);
    return {
      saved: await ctx.savePdf(html, {
        size: 'a4',
        defaultName: `statement-${fileWord(partyName, 'party')}-${req.to}.pdf`,
      }),
    };
  },
  'estimate.preview': (req, ctx) => {
    const { html, totalPaise } = estimatePage(ctx, req);
    return { html, totalPaise };
  },
  'estimate.print': async (req, ctx) => {
    const estimate = estimatePage(ctx, req);
    // through the print window, so the person can choose the paper and copies
    const printed = await ctx.printHtml(estimate.html, { size: req.size });
    if (printed) recordEstimate(ctx.db, { userId: ctx.user().id }, estimate);
    return { printed };
  },
  'estimate.pdf': async (req, ctx) => {
    const estimate = estimatePage(ctx, req);
    const saved = await ctx.savePdf(estimate.html, {
      size: req.size,
      defaultName: `estimate-${fileWord(estimate.partyName ?? 'cash', 'cash')}-${req.draft.date}.pdf`,
    });
    if (saved) recordEstimate(ctx.db, { userId: ctx.user().id }, estimate);
    return { saved };
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
