import {
  type Db,
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
  gstPurchases,
  gstPurchasesToCsv,
  reorderList,
  collectionList,
  collectionToCsv,
  reorderToCsv,
  stockSheetToCsv,
  itemLedger,
  listAudit,
  itemLedgerToCsv,
  ledgerToCsv,
  outstanding,
  outstandingToCsv,
  profitAndLoss,
  itemSales,
  itemSalesToCsv,
  profitAndLossToCsv,
  purchaseRegister,
  registerToCsv,
  salesRegister,
  stockStatus,
  stockStatusToCsv,
  trialBalance,
  trialBalanceToCsv,
  accountantFiles,
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
  itemSales: 'view_profit_and_loss',
  gstSummary: 'view_gst',
  gstr1: 'view_gst',
  gstr3b: 'view_gst',
  purchasesForCa: 'view_gst',
  reorder: 'view_daily_reports',
  collection: 'view_daily_reports',
};

/** Staff may open the ledger of customers, suppliers, cash and bank only. */
function staffMayOpenLedger(db: Db, accountId: number): boolean {
  const row = db
    .prepare(
      `WITH RECURSIVE ok(id) AS (
         SELECT id FROM account_group
          WHERE name IN ('Sundry Debtors', 'Sundry Creditors', 'Cash-in-Hand', 'Bank Accounts')
         UNION ALL SELECT g.id FROM account_group g JOIN ok ON g.parent_id = ok.id)
       SELECT 1 AS found FROM account WHERE id = ? AND group_id IN (SELECT id FROM ok)`,
    )
    .get(accountId);
  return row !== undefined;
}

function run(req: ReportRequest, ctx: HandlerContext): ReportResult {
  const user = ctx.user();
  if (!can(user.role, NEEDS[req.kind])) {
    throw new ValidationError('This report is for the owner. Please ask the owner.');
  }
  const db = ctx.db;
  switch (req.kind) {
    case 'ledger':
      if (!can(user.role, 'view_profit_and_loss') && !staffMayOpenLedger(db, req.accountId)) {
        throw new ValidationError('This account is for the owner. Please ask the owner.');
      }
      return { kind: 'ledger', data: accountLedger(db, req) };
    case 'stock':
      return {
        kind: 'stock',
        data: stockStatus(db, {
          asOn: req.asOn,
          ...(req.onlyProblems ? { onlyProblems: true } : {}),
        }),
        ...(req.countSheet ? { countSheet: true } : {}),
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
    case 'purchasesForCa':
      return { kind: 'purchasesForCa', data: gstPurchases(db, req) };
    case 'reorder':
      return { kind: 'reorder', data: reorderList(db, req) };
    case 'collection':
      return { kind: 'collection', data: collectionList(db, req) };
    case 'profitAndLoss':
      return { kind: 'profitAndLoss', data: profitAndLoss(db, req) };
    case 'itemSales':
      return { kind: 'itemSales', data: itemSales(db, req) };
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

export const reportHandlers: Pick<
  Handlers,
  'report.run' | 'report.export' | 'report.pdf' | 'books.export' | 'audit.list'
> = {
  'audit.list': (req, ctx) => listAudit(ctx.db, req),
  'report.run': (req, ctx) => run(req, ctx),
  'report.pdf': async (req, ctx) => {
    run(req, ctx); // refuses a report this person may not open
    return { saved: await ctx.savePagePdf(`${label(req)}.pdf`) };
  },
  'books.export': async (req, ctx) => {
    if (req.from > req.to) throw new ValidationError('The first date is after the last date.');
    return {
      saved: await ctx.saveFiles(
        accountantFiles(ctx.db, req),
        `accountant_${req.from}_to_${req.to}`,
      ),
    };
  },
  'report.export': async (req, ctx) => {
    const result = run(req, ctx);
    const name = label(req);
    switch (result.kind) {
      case 'gstr1':
        return { saved: await ctx.saveFiles(gstr1ToCsvFiles(result.data), name) };
      case 'ledger':
        return { saved: await ctx.saveText(`${name}.csv`, ledgerToCsv(result.data)) };
      case 'stock':
        return {
          saved: await ctx.saveText(
            `${name}.csv`,
            result.countSheet ? stockSheetToCsv(result.data) : stockStatusToCsv(result.data),
          ),
        };
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
      case 'purchasesForCa':
        return { saved: await ctx.saveText(`${name}.csv`, gstPurchasesToCsv(result.data)) };
      case 'reorder':
        return { saved: await ctx.saveText(`${name}.csv`, reorderToCsv(result.data)) };
      case 'collection':
        return { saved: await ctx.saveText(`${name}.csv`, collectionToCsv(result.data)) };
      case 'profitAndLoss':
        return { saved: await ctx.saveText(`${name}.csv`, profitAndLossToCsv(result.data)) };
      case 'itemSales':
        return { saved: await ctx.saveText(`${name}.csv`, itemSalesToCsv(result.data)) };
      case 'balanceSheet':
        return { saved: await ctx.saveText(`${name}.csv`, balanceSheetToCsv(result.data)) };
      case 'daySummary':
        throw new ValidationError('The day summary is shown on screen only.');
    }
  },
};
