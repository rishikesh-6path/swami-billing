import {
  NARRATION_KINDS,
  can,
  VOUCHER_TYPE_LABELS,
  getNarrations,
  ValidationError,
  cancelVoucher,
  defaultSeriesId,
  getCompanyStateCode,
  getSetting,
  getVoucherDetail,
  listBillSundries,
  listBrokers,
  listSaleTypes,
  listVoucherSeries,
  listVouchers,
  modifyVoucher,
  nextVoucherNumber,
  postVoucher,
  previewItemVoucher,
  searchAccounts,
  searchItems,
  searchParties,
  type VoucherInput,
  type VoucherType,
} from '@shopledger/core';
import type { z } from 'zod';
import type { voucherInput } from '../../ipc/contract.ts';
import type { HandlerContext, Handlers } from '../ipc.ts';

const STAFF_GROUPS = ['Sundry Debtors', 'Sundry Creditors'];

/** Entries that change the books without a bill: these are the owner's. */
const ADJUSTMENTS = ['journal', 'stock_journal', 'physical_stock', 'debit_note', 'credit_note'];
function assertMayPost(ctx: HandlerContext, type: string): void {
  if (ADJUSTMENTS.includes(type) && !can(ctx.user().role, 'post_adjustments')) {
    throw new ValidationError('This kind of entry is for the owner. Please ask the owner.');
  }
}

function asVoucherType(type: string): VoucherType {
  if (!(type in VOUCHER_TYPE_LABELS))
    throw new ValidationError('That kind of voucher is not known.');
  return type as VoucherType;
}

/** Fills in the number series when the screen did not choose one (it uses the first series of the type). */
function withSeries(ctx: HandlerContext, input: z.infer<typeof voucherInput>): VoucherInput {
  return {
    ...input,
    seriesId: input.seriesId ?? defaultSeriesId(ctx.db, input.type),
    createdBy: ctx.user().id,
  };
}

export const voucherHandlers: Pick<
  Handlers,
  | 'voucher.setup'
  | 'item.search'
  | 'party.search'
  | 'account.search'
  | 'voucher.preview'
  | 'voucher.post'
  | 'voucher.get'
  | 'voucher.list'
  | 'voucher.cancel'
  | 'voucher.modify'
> = {
  'voucher.setup': (req, ctx) => {
    const type = asVoucherType(req.type);
    const series = listVoucherSeries(ctx.db, type);
    const seriesId = defaultSeriesId(ctx.db, type);
    const paymentAccounts = ctx.db
      .prepare(
        `WITH RECURSIVE tree(id) AS (
           SELECT id FROM account_group WHERE name IN ('Cash-in-Hand', 'Bank Accounts')
           UNION ALL SELECT g.id FROM account_group g JOIN tree t ON g.parent_id = t.id)
         SELECT id, name FROM account WHERE group_id IN (SELECT id FROM tree)
         ORDER BY CASE WHEN is_system = 1 THEN 0 ELSE 1 END, name`,
      )
      .all()
      .map((r) => ({ id: Number(r['id']), name: String(r['name']) }));
    const cash = ctx.db
      .prepare("SELECT id FROM account WHERE name = 'Cash' AND is_system = 1")
      .get();
    return {
      today: ctx.today(),
      series,
      defaultSeriesId: seriesId,
      nextNumber: nextVoucherNumber(ctx.db, type, seriesId, req.date),
      autoPrint: getSetting(ctx.db, 'print.auto') === '1',
      printSize:
        getSetting(ctx.db, 'print.size') === 'thermal' ? ('thermal' as const) : ('a4' as const),
      saleTypes: listSaleTypes(ctx.db),
      sundries: listBillSundries(ctx.db),
      brokers: listBrokers(ctx.db),
      narrations: (NARRATION_KINDS as readonly string[]).includes(type)
        ? getNarrations(ctx.db, type)
        : [],
      paymentAccounts,
      cashAccountId: Number(cash?.['id']),
      shopStateCode: getCompanyStateCode(ctx.db),
    };
  },
  'item.search': (req, ctx) =>
    searchItems(ctx.db, req.text, {
      onDate: req.onDate,
      ...(req.limit ? { limit: req.limit } : {}),
    }),
  'party.search': (req, ctx) =>
    searchParties(ctx.db, { text: req.text, kind: req.kind, asOn: req.asOn }),
  'account.search': (req, ctx) => {
    const hits = searchAccounts(ctx.db, { text: req.text, kind: req.kind, asOn: req.asOn });
    // staff see customers, suppliers, cash and bank only, never capital, sales or loan accounts
    return can(ctx.user().role, 'view_profit_and_loss')
      ? hits
      : hits.filter((a) => a.isCashOrBank || STAFF_GROUPS.includes(a.groupName));
  },
  'voucher.preview': (req, ctx) =>
    previewItemVoucher(ctx.db, {
      ...req,
      seriesId: req.seriesId ?? 0,
      partyAccountId: req.partyAccountId ?? 0,
    }),
  'voucher.post': (req, ctx) => {
    assertMayPost(ctx, req.type);
    return postVoucher(ctx.db, withSeries(ctx, req), { role: ctx.user().role });
  },
  'voucher.get': (req, ctx) => getVoucherDetail(ctx.db, req.id) ?? null,
  'voucher.list': (req, ctx) => listVouchers(ctx.db, req),
  'voucher.cancel': (req, ctx) => {
    const user = ctx.user();
    const bill = getVoucherDetail(ctx.db, req.id);
    if (bill) assertMayPost(ctx, bill.voucherType);
    cancelVoucher(ctx.db, req.id, { userId: user.id, role: user.role, reason: req.reason });
    return null;
  },
  'voucher.modify': (req, ctx) => {
    const user = ctx.user();
    assertMayPost(ctx, req.input.type);
    return modifyVoucher(ctx.db, req.id, withSeries(ctx, req.input), {
      role: user.role,
      userId: user.id,
    });
  },
};
