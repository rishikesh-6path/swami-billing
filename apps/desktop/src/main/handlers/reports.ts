import {
  ValidationError,
  accountLedger,
  balanceSheet,
  balanceSheetToCsv,
  can,
  dayBook,
  dayBookToCsv,
  daySummary,
  gstSummary,
  gstSummaryToCsv,
  gstr1,
  gstr1ToCsvFiles,
  gstr3b,
  gstr3bToCsv,
  itemLedger,
  itemLedgerToCsv,
  ledgerToCsv,
  outstanding,
  outstandingToCsv,
  profitAndLoss,
  profitAndLossToCsv,
  purchaseRegister,
  registerToCsv,
  salesRegister,
  stockStatus,
  stockStatusToCsv,
  trialBalance,
  trialBalanceToCsv,
  type Action,
} from '@shopledger/core';
import type { ReportRequest, ReportResult } from '../../ipc/contract.ts';
import type { HandlerContext, Handlers } from '../ipc.ts';

/** What a user needs to be allowed to open each report. Daily reports are open to staff. */
const NEEDS: Record<ReportRequest['kind'], Action> = {
  ledger: 'view_daily_reports',
  stock: 'view_daily_reports',
  itemLedger: 'view_daily_reports',
  dayBook: 'view_daily_reports',
  daySummary: 'view_daily_reports',
  outstanding: 'view_daily_reports',
  salesRegister: 'view_daily_reports',
  purchaseRegister: 'view_daily_reports',
  trialBalance: 'view_balance_sheet',
  balanceSheet: 'view_balance_sheet',
  profitAndLoss: 'view_profit_and_loss',
  gstSummary: 'view_gst',
  gstr1: 'view_gst',
  gstr3b: 'view_gst',
};

function run(req: ReportRequest, ctx: HandlerContext): ReportResult {
  const user = ctx.user();
  if (!can(user.role, NEEDS[req.kind])) {
    throw new ValidationError('This report is for the owner. Please ask the owner.');
  }
  const db = ctx.db;
  switch (req.kind) {
    case 'ledger':
      return { kind: 'ledger', data: accountLedger(db, req) };
    case 'stock':
      return {
        kind: 'stock',
        data: stockStatus(db, {
          asOn: req.asOn,
          ...(req.onlyProblems ? { onlyProblems: true } : {}),
        }),
      };
    case 'itemLedger':
      return { kind: 'itemLedger', data: itemLedger(db, req) };
    case 'trialBalance':
      return { kind: 'trialBalance', data: trialBalance(db, req) };
    case 'dayBook':
      return { kind: 'dayBook', data: dayBook(db, req) };
    case 'daySummary':
      return { kind: 'daySummary', data: daySummary(db, { date: req.date }) };
    case 'outstanding':
      return { kind: 'outstanding', data: outstanding(db, req) };
    case 'salesRegister':
      return { kind: 'salesRegister', data: salesRegister(db, req) };
    case 'purchaseRegister':
      return { kind: 'purchaseRegister', data: purchaseRegister(db, req) };
    case 'gstSummary':
      return { kind: 'gstSummary', data: gstSummary(db, req) };
    case 'gstr1':
      return { kind: 'gstr1', data: gstr1(db, req) };
    case 'gstr3b':
      return { kind: 'gstr3b', data: gstr3b(db, req) };
    case 'profitAndLoss':
      return { kind: 'profitAndLoss', data: profitAndLoss(db, req) };
    case 'balanceSheet':
      return { kind: 'balanceSheet', data: balanceSheet(db, req) };
  }
}

const label = (req: ReportRequest): string => {
  const when =
    'from' in req
      ? `${req.from}_to_${req.to}`
      : 'asOn' in req
        ? req.asOn
        : req.kind === 'daySummary'
          ? req.date
          : '';
  return `${req.kind}_${when}`;
};

export const reportHandlers: Pick<Handlers, 'report.run' | 'report.export'> = {
  'report.run': (req, ctx) => run(req, ctx),
  'report.export': async (req, ctx) => {
    const result = run(req, ctx);
    const name = label(req);
    switch (result.kind) {
      case 'gstr1':
        return { saved: await ctx.saveFiles(gstr1ToCsvFiles(result.data)) };
      case 'ledger':
        return { saved: await ctx.saveText(`${name}.csv`, ledgerToCsv(result.data)) };
      case 'stock':
        return { saved: await ctx.saveText(`${name}.csv`, stockStatusToCsv(result.data)) };
      case 'itemLedger':
        return { saved: await ctx.saveText(`${name}.csv`, itemLedgerToCsv(result.data)) };
      case 'trialBalance':
        return { saved: await ctx.saveText(`${name}.csv`, trialBalanceToCsv(result.data)) };
      case 'dayBook':
        return { saved: await ctx.saveText(`${name}.csv`, dayBookToCsv(result.data)) };
      case 'outstanding':
        return { saved: await ctx.saveText(`${name}.csv`, outstandingToCsv(result.data)) };
      case 'salesRegister':
      case 'purchaseRegister':
        return { saved: await ctx.saveText(`${name}.csv`, registerToCsv(result.data)) };
      case 'gstSummary':
        return { saved: await ctx.saveText(`${name}.csv`, gstSummaryToCsv(result.data)) };
      case 'gstr3b':
        return { saved: await ctx.saveText(`${name}.csv`, gstr3bToCsv(result.data)) };
      case 'profitAndLoss':
        return { saved: await ctx.saveText(`${name}.csv`, profitAndLossToCsv(result.data)) };
      case 'balanceSheet':
        return { saved: await ctx.saveText(`${name}.csv`, balanceSheetToCsv(result.data)) };
      case 'daySummary':
        throw new ValidationError('The day summary is shown on screen only.');
    }
  },
};
