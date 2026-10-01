import {
  VOUCHER_TYPE_LABELS,
  ValidationError,
  cancelVoucher,
  defaultSeriesId,
  getCompanyStateCode,
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
  searchItems,
  searchParties,
  type VoucherInput,
  type VoucherType,
} from '@shopledger/core';
import type { z } from 'zod';
import type { voucherInput } from '../../ipc/contract.ts';
import type { HandlerContext, Handlers } from '../ipc.ts';

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
      saleTypes: listSaleTypes(ctx.db),
      sundries: listBillSundries(ctx.db),
      brokers: listBrokers(ctx.db),
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
  'voucher.preview': (req, ctx) =>
    previewItemVoucher(ctx.db, {
      ...req,
      seriesId: req.seriesId ?? 0,
      partyAccountId: req.partyAccountId ?? 0,
    }),
  'voucher.post': (req, ctx) =>
    postVoucher(ctx.db, withSeries(ctx, req), { role: ctx.user().role }),
  'voucher.get': (req, ctx) => getVoucherDetail(ctx.db, req.id) ?? null,
  'voucher.list': (req, ctx) => listVouchers(ctx.db, req),
  'voucher.cancel': (req, ctx) => {
    const user = ctx.user();
    cancelVoucher(ctx.db, req.id, { userId: user.id, role: user.role, reason: req.reason });
    return null;
  },
  'voucher.modify': (req, ctx) => {
    const user = ctx.user();
    return modifyVoucher(ctx.db, req.id, withSeries(ctx, req.input), {
      role: user.role,
      userId: user.id,
    });
  },
};
