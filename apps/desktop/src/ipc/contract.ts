import { z } from 'zod';
import type {
  Action,
  BillSundryRow,
  Company,
  AccountHit,
  AccountLedger,
  BalanceSheet,
  DayBookRow,
  DaySummary,
  Gstr1,
  Gstr3b,
  GstSummary,
  ItemLedger,
  PartyOutstanding,
  ProfitAndLoss,
  Register,
  StockStatus,
  TrialBalance,
  AccountRow,
  AuditRow,
  ItemGroupRow,
  ItemRow,
  UnitRow,
  ItemSearchRow,
  PartyHit,
  PostedVoucher,
  Role,
  SaleTypeRow,
  SeriesRow,
  VoucherDetail,
  VoucherListRow,
  VoucherPreview,
} from '@shopledger/core';

/**
 * The only boundary between the renderer and everything else. Every channel declares who may
 * call it (`access`), a zod request schema (checked in main, the trust boundary) and a response
 * type. Add new channels here; handlers live in src/main/handlers.
 */

export const id = z.number().int().positive();
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Who may call a channel: anyone, any signed-in user, or users allowed to perform an action. */
export type Access = 'public' | 'user' | Action;

function channel<Q extends z.ZodType, R>(access: Access, request: Q) {
  return { access, request, response: null as unknown as R };
}

export interface SessionUser {
  id: number;
  name: string;
  role: Role;
}

export interface SessionState {
  setupComplete: boolean;
  /** The financial year containing today (1 April to 31 March), if one exists. */
  financialYear: { startDate: string; endDate: string; label: string } | null;
  user: SessionUser | null;
  today: string;
  company: Company | null;
}

export interface HomeSummary {
  todaySalesPaise: number;
  todayBills: number;
  cashInHandPaise: number;
  toCollectPaise: number;
  lowStockItems: number;
}

const none = z.object({}).strict();

const paise = z.number().int().min(0);

const taxMode = z.enum(['local', 'interstate', 'exempt']);
const itemVoucherType = z.enum(['sales', 'sales_return', 'purchase', 'purchase_return']);
const entryVoucherType = z.enum([
  'receipt',
  'payment',
  'journal',
  'contra',
  'debit_note',
  'credit_note',
]);

const commonVoucher = {
  date: isoDate,
  seriesId: id.optional(),
  narration: z.string().max(500).optional(),
  broker: z.string().max(100).optional(),
  refVoucherId: id.optional(),
};

const itemLine = z.object({
  itemId: id,
  qty: z.number().int().positive(),
  unitId: id,
  listPricePaise: paise,
  discBp: z.number().int().min(0).max(10000).optional(),
});

/** A bill being typed: lines may be unfinished, so ids and quantities may still be zero. */
const draftLine = z.object({
  itemId: z.number().int().min(0),
  qty: z.number().int().min(0),
  unitId: z.number().int().min(0),
  listPricePaise: paise,
  discBp: z.number().int().min(0).max(10000).optional(),
});

const sundryInput = z.object({ billSundryId: id, amountPaise: paise });
const settlementInput = z.object({ accountId: id, amountPaise: z.number().int().positive() });

const itemVoucherFields = {
  type: itemVoucherType,
  ...commonVoucher,
  partyAccountId: id,
  saleTypeId: id.optional(),
  taxMode,
  sundries: z.array(sundryInput).max(20).optional(),
  settlements: z.array(settlementInput).max(5).optional(),
  roundOff: z.boolean().optional(),
};
export const itemVoucherInput = z.object({
  ...itemVoucherFields,
  lines: z.array(itemLine).min(1).max(200),
});
export const itemVoucherDraft = z.object({
  ...itemVoucherFields,
  partyAccountId: id.optional(),
  lines: z.array(draftLine).max(200),
});

export const entryVoucherInput = z.object({
  type: entryVoucherType,
  ...commonVoucher,
  partyAccountId: id.optional(),
  entries: z
    .array(
      z.object({
        accountId: id,
        side: z.enum(['dr', 'cr']),
        amountPaise: z.number().int().positive(),
      }),
    )
    .min(2)
    .max(50),
});

export const stockVoucherInput = z.union([
  z.object({
    type: z.literal('stock_journal'),
    ...commonVoucher,
    lines: z
      .array(
        z.object({
          itemId: id,
          qty: z.number().int().positive(),
          unitId: id,
          direction: z.enum(['in', 'out']),
          ratePaise: paise.optional(),
        }),
      )
      .min(1)
      .max(100),
  }),
  z.object({
    type: z.literal('physical_stock'),
    ...commonVoucher,
    lines: z
      .array(z.object({ itemId: id, unitId: id, countedQty: z.number().int().min(0) }))
      .min(1)
      .max(500),
  }),
]);

export const voucherInput = z.union([itemVoucherInput, entryVoucherInput, stockVoucherInput]);

export interface ItemDetail {
  item: ItemRow;
  taxHistory: { effectiveFrom: string; rateBp: number }[];
}

const itemFields = {
  name: z.string().max(120),
  alias: z.string().max(40).nullable(),
  groupId: id,
  unitId: id,
  hsn: z.string().max(12).nullable(),
  openingQty: z.number().int(),
  openingRatePaise: paise,
  salePricePaise: paise,
  mrpPaise: paise,
  minStockQty: paise,
};

const partyFields = {
  name: z.string().max(120),
  gstin: z.string().max(20).nullable(),
  stateCode: z.string().max(4).nullable(),
  phone: z.string().max(30).nullable(),
  address: z.string().max(300).nullable(),
  creditDays: z.number().int().min(0).max(3650),
  openingBalancePaise: paise,
  openingIsDr: z.boolean(),
};

const period = { from: isoDate, to: isoDate };

/** Every report the app can show. Which ones a user may open is checked in main, per kind. */
export const reportRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ledger'), accountId: id, ...period }),
  z.object({ kind: z.literal('stock'), asOn: isoDate, onlyProblems: z.boolean().optional() }),
  z.object({ kind: z.literal('itemLedger'), itemId: id, ...period }),
  z.object({ kind: z.literal('trialBalance'), ...period }),
  z.object({ kind: z.literal('dayBook'), ...period }),
  z.object({ kind: z.literal('daySummary'), date: isoDate }),
  z.object({
    kind: z.literal('outstanding'),
    asOn: isoDate,
    side: z.enum(['receivable', 'payable']),
  }),
  z.object({ kind: z.literal('salesRegister'), ...period }),
  z.object({ kind: z.literal('purchaseRegister'), ...period }),
  z.object({ kind: z.literal('gstSummary'), ...period }),
  z.object({ kind: z.literal('gstr1'), ...period }),
  z.object({ kind: z.literal('gstr3b'), ...period }),
  z.object({ kind: z.literal('profitAndLoss'), ...period }),
  z.object({ kind: z.literal('balanceSheet'), asOn: isoDate }),
]);
export type ReportRequest = z.infer<typeof reportRequest>;

export type ReportResult =
  | { kind: 'ledger'; data: AccountLedger }
  | { kind: 'stock'; data: StockStatus }
  | { kind: 'itemLedger'; data: ItemLedger }
  | { kind: 'trialBalance'; data: TrialBalance }
  | { kind: 'dayBook'; data: DayBookRow[] }
  | { kind: 'daySummary'; data: DaySummary }
  | { kind: 'outstanding'; data: PartyOutstanding[] }
  | { kind: 'salesRegister'; data: Register }
  | { kind: 'purchaseRegister'; data: Register }
  | { kind: 'gstSummary'; data: GstSummary }
  | { kind: 'gstr1'; data: Gstr1 }
  | { kind: 'gstr3b'; data: Gstr3b }
  | { kind: 'profitAndLoss'; data: ProfitAndLoss }
  | { kind: 'balanceSheet'; data: BalanceSheet };

export interface VoucherScreenSetup {
  today: string;
  series: SeriesRow[];
  defaultSeriesId: number;
  nextNumber: number;
  saleTypes: SaleTypeRow[];
  sundries: BillSundryRow[];
  brokers: string[];
  /** Print the bill straight after a sale is saved, and on which paper. */
  autoPrint: boolean;
  printSize: 'a4' | 'thermal';
  /** Cash and bank accounts a customer can pay into (or we can pay from). */
  paymentAccounts: { id: number; name: string }[];
  cashAccountId: number;
  shopStateCode: string;
}

export const contract = {
  'app.info': channel<typeof none, { dbPath: string; schemaVersion: number }>('public', none),
  'session.state': channel<typeof none, SessionState>('public', none),
  'setup.complete': channel<
    z.ZodObject<{
      shopName: z.ZodString;
      address: z.ZodString;
      stateCode: z.ZodString;
      gstin: z.ZodString;
      phone: z.ZodString;
      ownerName: z.ZodString;
      ownerPin: z.ZodString;
    }>,
    SessionState
  >(
    'public',
    z.object({
      shopName: z.string(),
      address: z.string(),
      stateCode: z.string(),
      gstin: z.string(),
      phone: z.string(),
      ownerName: z.string(),
      ownerPin: z.string(),
    }),
  ),
  'auth.users': channel<typeof none, { id: number; name: string }[]>('public', none),
  'auth.login': channel<z.ZodObject<{ name: z.ZodString; pin: z.ZodString }>, SessionState>(
    'public',
    z.object({ name: z.string(), pin: z.string() }),
  ),
  'auth.logout': channel<typeof none, SessionState>('public', none),
  'lookup.states': channel<typeof none, { code: string; name: string }[]>('public', none),
  'home.summary': channel<typeof none, HomeSummary>('user', none),
  'voucher.setup': channel<
    z.ZodObject<{ type: z.ZodString; date: typeof isoDate }>,
    VoucherScreenSetup
  >('bill', z.object({ type: z.string(), date: isoDate })),
  'item.search': channel<
    z.ZodObject<{ text: z.ZodString; onDate: typeof isoDate; limit: z.ZodOptional<z.ZodNumber> }>,
    ItemSearchRow[]
  >(
    'bill',
    z.object({
      text: z.string().max(100),
      onDate: isoDate,
      limit: z.number().int().min(1).max(50).optional(),
    }),
  ),
  'party.search': channel<
    z.ZodObject<{
      text: z.ZodString;
      kind: z.ZodEnum<{ customer: 'customer'; supplier: 'supplier'; any: 'any' }>;
      asOn: typeof isoDate;
    }>,
    PartyHit[]
  >(
    'bill',
    z.object({
      text: z.string().max(100),
      kind: z.enum(['customer', 'supplier', 'any']),
      asOn: isoDate,
    }),
  ),
  'item.list': channel<
    z.ZodObject<{ text: z.ZodOptional<z.ZodString>; includeInactive: z.ZodOptional<z.ZodBoolean> }>,
    ItemRow[]
  >(
    'edit_masters',
    z.object({ text: z.string().max(100).optional(), includeInactive: z.boolean().optional() }),
  ),
  'item.get': channel<z.ZodObject<{ id: typeof id }>, ItemDetail | null>(
    'edit_masters',
    z.object({ id }),
  ),
  'item.save': channel<
    z.ZodObject<
      typeof itemFields & {
        id: z.ZodOptional<typeof id>;
        isActive: z.ZodOptional<z.ZodBoolean>;
        taxRateBp: z.ZodOptional<z.ZodNumber>;
        taxEffectiveFrom: z.ZodOptional<typeof isoDate>;
      }
    >,
    number
  >(
    'edit_masters',
    z.object({
      ...itemFields,
      id: id.optional(),
      isActive: z.boolean().optional(),
      taxRateBp: z.number().int().min(0).max(5000).optional(),
      taxEffectiveFrom: isoDate.optional(),
    }),
  ),
  'item.delete': channel<z.ZodObject<{ id: typeof id }>, null>('edit_masters', z.object({ id })),
  'itemgroup.list': channel<typeof none, ItemGroupRow[]>('edit_masters', none),
  'itemgroup.create': channel<z.ZodObject<{ name: z.ZodString }>, number>(
    'edit_masters',
    z.object({ name: z.string().max(120) }),
  ),
  'unit.list': channel<typeof none, UnitRow[]>('edit_masters', none),
  'unit.create': channel<z.ZodObject<{ name: z.ZodString; allowDecimals: z.ZodBoolean }>, number>(
    'edit_masters',
    z.object({ name: z.string().max(40), allowDecimals: z.boolean() }),
  ),
  'party.list': channel<
    z.ZodObject<{
      kind: z.ZodEnum<{ customer: 'customer'; supplier: 'supplier'; all: 'all' }>;
      text: z.ZodOptional<z.ZodString>;
      asOn: typeof isoDate;
    }>,
    (AccountRow & { balancePaise: number })[]
  >(
    'edit_masters',
    z.object({
      kind: z.enum(['customer', 'supplier', 'all']),
      text: z.string().max(100).optional(),
      asOn: isoDate,
    }),
  ),
  'party.get': channel<z.ZodObject<{ id: typeof id }>, AccountRow | null>(
    'edit_masters',
    z.object({ id }),
  ),
  'party.save': channel<
    z.ZodObject<
      typeof partyFields & {
        id: z.ZodOptional<typeof id>;
        kind: z.ZodOptional<z.ZodEnum<{ customer: 'customer'; supplier: 'supplier' }>>;
      }
    >,
    number
  >(
    'edit_masters',
    z.object({
      ...partyFields,
      id: id.optional(),
      kind: z.enum(['customer', 'supplier']).optional(),
    }),
  ),
  'party.delete': channel<z.ZodObject<{ id: typeof id }>, null>('edit_masters', z.object({ id })),
  'report.run': channel<typeof reportRequest, ReportResult>('view_daily_reports', reportRequest),
  'report.export': channel<typeof reportRequest, { saved: string | null }>(
    'view_daily_reports',
    reportRequest,
  ),
  'print.preview': channel<
    z.ZodObject<{ id: typeof id; size: z.ZodEnum<{ a4: 'a4'; thermal: 'thermal' }> }>,
    { html: string; title: string }
  >('bill', z.object({ id, size: z.enum(['a4', 'thermal']) })),
  'print.run': channel<
    z.ZodObject<{ id: typeof id; size: z.ZodEnum<{ a4: 'a4'; thermal: 'thermal' }> }>,
    { printed: boolean }
  >('bill', z.object({ id, size: z.enum(['a4', 'thermal']) })),
  'print.pdf': channel<
    z.ZodObject<{ id: typeof id; size: z.ZodEnum<{ a4: 'a4'; thermal: 'thermal' }> }>,
    { saved: string | null }
  >('bill', z.object({ id, size: z.enum(['a4', 'thermal']) })),
  'audit.list': channel<
    z.ZodObject<{
      from: z.ZodOptional<typeof isoDate>;
      to: z.ZodOptional<typeof isoDate>;
      text: z.ZodOptional<z.ZodString>;
    }>,
    AuditRow[]
  >(
    'view_audit_log',
    z.object({
      from: isoDate.optional(),
      to: isoDate.optional(),
      text: z.string().max(100).optional(),
    }),
  ),
  'account.search': channel<
    z.ZodObject<{
      text: z.ZodString;
      kind: z.ZodEnum<{ any: 'any'; cash_bank: 'cash_bank'; other: 'other' }>;
      asOn: typeof isoDate;
    }>,
    AccountHit[]
  >(
    'bill',
    z.object({
      text: z.string().max(100),
      kind: z.enum(['any', 'cash_bank', 'other']),
      asOn: isoDate,
    }),
  ),
  'voucher.preview': channel<typeof itemVoucherDraft, VoucherPreview>('bill', itemVoucherDraft),
  'voucher.post': channel<typeof voucherInput, PostedVoucher>('bill', voucherInput),
  'voucher.get': channel<z.ZodObject<{ id: typeof id }>, VoucherDetail | null>(
    'bill',
    z.object({ id }),
  ),
  'voucher.list': channel<
    z.ZodObject<{
      voucherType: z.ZodOptional<z.ZodString>;
      from: z.ZodOptional<typeof isoDate>;
      to: z.ZodOptional<typeof isoDate>;
      partyId: z.ZodOptional<typeof id>;
      search: z.ZodOptional<z.ZodString>;
      includeCancelled: z.ZodOptional<z.ZodBoolean>;
    }>,
    VoucherListRow[]
  >(
    'bill',
    z.object({
      voucherType: z.string().optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      partyId: id.optional(),
      search: z.string().max(100).optional(),
      includeCancelled: z.boolean().optional(),
    }),
  ),
  'voucher.cancel': channel<z.ZodObject<{ id: typeof id; reason: z.ZodString }>, null>(
    'cancel_voucher',
    z.object({ id, reason: z.string().max(300) }),
  ),
  'voucher.modify': channel<
    z.ZodObject<{ id: typeof id; input: typeof voucherInput }>,
    PostedVoucher
  >('cancel_voucher', z.object({ id, input: voucherInput })),
} as const;

export type Channel = keyof typeof contract;
export type Req<C extends Channel> = z.infer<(typeof contract)[C]['request']>;
export type Res<C extends Channel> = (typeof contract)[C]['response'];

/** What main sends back: either the data, or a message already written for shop staff. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; message: string };

export interface ShopledgerApi {
  invoke<C extends Channel>(channel: C, request: Req<C>): Promise<Res<C>>;
}

export const channels = Object.keys(contract) as Channel[];
