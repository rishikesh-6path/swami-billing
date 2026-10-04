import {
  NARRATION_KINDS,
  can,
  VOUCHER_TYPE_LABELS,
  getNarrations,
  ValidationError,
  cancelVoucher,
  transaction,
  creditCheck,
  limitedBalances,
  newlyOverLimit,
  discardHeld,
  formatMoney,
  getStaffMaxDiscountBp,
  staffDiscountProblem,
  writeAudit,
  type CreditCheck,
  type ItemVoucherInput,
  holdBill,
  listHeld,
  peekHeld,
  finishHeld,
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
import { heldPayload, type voucherInput } from '../../ipc/contract.ts';
import type { HandlerContext, Handlers } from '../ipc.ts';
import { ensureCurrentYear } from './session.ts';

const STAFF_GROUPS = ['Sundry Debtors', 'Sundry Creditors'];

/** Entries that change the books without a bill: these are the owner's. */
const ADJUSTMENTS = ['journal', 'stock_journal', 'physical_stock', 'debit_note', 'credit_note'];
function assertMayPost(ctx: HandlerContext, type: string): void {
  if (ADJUSTMENTS.includes(type) && !can(ctx.user().role, 'post_adjustments')) {
    throw new ValidationError('This kind of entry is for the owner. Please ask the owner.');
  }
}

const whoIs = (ctx: HandlerContext) => {
  const user = ctx.user();
  return { userId: user.id, isOwner: user.role === 'owner' };
};

/**
 * The shop's controls on a sale: staff cannot give more discount than the owner allows, and a
 * customer may not go above their credit limit (staff are stopped; the owner must confirm, and
 * that is recorded). Returns what to record after the bill is saved, if anything.
 */
function guardSale(
  ctx: HandlerContext,
  req: z.infer<typeof voucherInput>,
  excludeVoucherId?: number,
): { check: CreditCheck } | null {
  if (req.type !== 'sales' || !('lines' in req) || !('partyAccountId' in req)) return null;
  const input = withSeries(ctx, req) as ItemVoucherInput;
  const user = ctx.user();
  const isOwner = user.role === 'owner';
  if (!isOwner) {
    const problem = staffDiscountProblem(
      ctx.db,
      input,
      getStaffMaxDiscountBp(ctx.db),
      excludeVoucherId,
    );
    if (problem) throw new ValidationError(problem);
  }
  const total = previewItemVoucher(ctx.db, input).totalPaise;
  const received = (input.settlements ?? []).reduce((t, s) => t + s.amountPaise, 0);
  const check = creditCheck(ctx.db, {
    partyId: input.partyAccountId,
    billPaise: total - received,
    excludeVoucherId,
  });
  if (!check?.over) return null;
  const name = String(
    ctx.db.prepare('SELECT name FROM account WHERE id = ?').get(input.partyAccountId)?.['name'],
  );
  const text = `${name} would owe ₹${formatMoney(check.afterPaise)} after this bill. Their limit is ₹${formatMoney(check.limitPaise)}.`;
  if (!isOwner) {
    throw new ValidationError(
      `${text} Please ask the owner, or take some money now so the amount owed stays within the limit.`,
    );
  }
  if (!(req as { overrideCredit?: boolean }).overrideCredit) {
    throw new ValidationError(`${text} Please confirm that you want to go on.`);
  }
  return { check };
}

function recordOverride(
  ctx: HandlerContext,
  over: { check: CreditCheck } | null,
  voucherId: number,
): void {
  if (!over) return;
  writeAudit(
    ctx.db,
    { userId: ctx.user().id },
    {
      action: 'credit_limit_override',
      table: 'voucher',
      rowId: voucherId,
      after: { limitPaise: over.check.limitPaise, owingAfterPaise: over.check.afterPaise },
    },
  );
}

/**
 * Staff may not take any customer above their credit limit by any entry: a payment that gives a
 * customer money, a receipt made smaller, a return or receipt cancelled. The change is made, what
 * each limited customer owes is compared with before, and the whole change is undone if staff took
 * someone over. The owner is not stopped here (sales ask the owner to confirm in guardSale).
 */
function withStaffLimit<T>(ctx: HandlerContext, change: () => T): T {
  if (ctx.user().role === 'owner') return change();
  return transaction(ctx.db, () => {
    const before = limitedBalances(ctx.db);
    const result = change();
    const breach = newlyOverLimit(ctx.db, before);
    if (breach) {
      throw new ValidationError(
        `This would take ${breach.name} above their credit limit of ₹${formatMoney(breach.limitPaise)} (they would owe ₹${formatMoney(breach.owingPaise)}). Please ask the owner.`,
      );
    }
    return result;
  });
}

function asVoucherType(type: string): VoucherType {
  if (!(type in VOUCHER_TYPE_LABELS))
    throw new ValidationError('That kind of voucher is not known.');
  return type as VoucherType;
}

/** Fills in the number series when the screen did not choose one (it uses the first series of the type). */
function withSeries(ctx: HandlerContext, input: z.infer<typeof voucherInput>): VoucherInput {
  // `overrideCredit` is a confirmation for this request, not part of the bill
  const bill = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== 'overrideCredit'),
  ) as unknown as VoucherInput;
  return {
    ...bill,
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
  | 'credit.check'
  | 'bill.hold'
  | 'bill.held'
  | 'bill.take'
  | 'bill.finish'
  | 'bill.discard'
> = {
  'voucher.setup': (req, ctx) => {
    ensureCurrentYear(ctx);
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
    ensureCurrentYear(ctx);
    assertMayPost(ctx, req.type);
    // the checks, the bill and the override record are saved together or not at all
    return transaction(ctx.db, () => {
      const over = guardSale(ctx, req);
      const posted = withStaffLimit(ctx, () =>
        postVoucher(ctx.db, withSeries(ctx, req), { role: ctx.user().role }),
      );
      recordOverride(ctx, over, posted.voucherId);
      return posted;
    });
  },
  'voucher.get': (req, ctx) => getVoucherDetail(ctx.db, req.id) ?? null,
  'voucher.list': (req, ctx) => listVouchers(ctx.db, req),
  'voucher.cancel': (req, ctx) => {
    const user = ctx.user();
    const bill = getVoucherDetail(ctx.db, req.id);
    if (bill) assertMayPost(ctx, bill.voucherType);
    withStaffLimit(ctx, () =>
      cancelVoucher(ctx.db, req.id, { userId: user.id, role: user.role, reason: req.reason }),
    );
    return null;
  },
  'voucher.modify': (req, ctx) => {
    const user = ctx.user();
    assertMayPost(ctx, req.input.type);
    return transaction(ctx.db, () => {
      const over = guardSale(ctx, req.input, req.id);
      const posted = withStaffLimit(ctx, () =>
        modifyVoucher(ctx.db, req.id, withSeries(ctx, req.input), {
          role: user.role,
          userId: user.id,
        }),
      );
      recordOverride(ctx, over, posted.voucherId);
      return posted;
    });
  },
  'credit.check': (req, ctx) => creditCheck(ctx.db, req),
  'bill.hold': (req, ctx) => {
    const user = ctx.user();
    return holdBill(ctx.db, {
      kind: req.kind,
      userId: user.id,
      label: req.label,
      payload: req.payload,
    });
  },
  'bill.held': (_req, ctx) => listHeld(ctx.db, whoIs(ctx)),
  'bill.take': (req, ctx) => {
    const held = peekHeld(ctx.db, req.id, whoIs(ctx));
    const payload = heldPayload.safeParse(held.payload);
    if (!payload.success) {
      throw new ValidationError(
        'This set-aside bill cannot be opened. Please throw it away and make the bill again.',
      );
    }
    return { kind: held.kind, label: held.label, payload: payload.data };
  },
  'bill.finish': (req, ctx) => {
    finishHeld(ctx.db, req.id, whoIs(ctx));
    return null;
  },
  'bill.discard': (req, ctx) => {
    discardHeld(ctx.db, req.id, whoIs(ctx));
    return null;
  },
};
