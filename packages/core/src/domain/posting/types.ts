import type { BasisPoints, Milli, Paise } from '../../money.ts';

export type ItemVoucherType =
  'sales' | 'sales_return' | 'purchase' | 'purchase_return' | 'credit_note' | 'debit_note';
export type EntryVoucherType = 'receipt' | 'payment' | 'journal' | 'contra';
export type StockVoucherType = 'stock_journal' | 'physical_stock';
export type VoucherType = ItemVoucherType | EntryVoucherType | StockVoucherType;
/**
 * Credit and debit notes adjust the value of an earlier bill (a price difference, a discount
 * given later) without moving any stock. Their lines carry a taxable value and a GST rate, so they
 * flow into the GST returns like the bill they correct.
 */
export const isNoteType = (type: string): boolean =>
  type === 'credit_note' || type === 'debit_note';

export type TaxMode = 'local' | 'interstate' | 'exempt';

interface VoucherCommon {
  date: string;
  seriesId: number;
  narration?: string | undefined;
  broker?: string | undefined;
  createdBy?: number | undefined;
  refVoucherId?: number | undefined;
  legacyRef?: string | undefined;
}

export interface ItemLineInput {
  itemId: number;
  qty: Milli;
  unitId: number;
  /** For credit and debit notes this is the value of the line before GST, and `qty` is ignored. */
  listPricePaise: Paise;
  discBp?: BasisPoints | undefined;
  /** Frozen on the voucher. When omitted, resolved from item_tax_rate as of the voucher date. */
  taxRateBp?: BasisPoints | undefined;
  /** Frozen on the voucher. When omitted, taken from the item master. */
  hsn?: string | undefined;
}

export interface SundryInput {
  billSundryId: number;
  /** Positive amount; the bill sundry master decides whether it adds or subtracts. */
  amountPaise: Paise;
}

export interface SettlementInput {
  accountId: number;
  amountPaise: Paise;
}

export interface ItemVoucherInput extends VoucherCommon {
  type: ItemVoucherType;
  partyAccountId: number;
  saleTypeId?: number | undefined;
  taxMode: TaxMode;
  lines: ItemLineInput[];
  sundries?: SundryInput[] | undefined;
  settlements?: SettlementInput[] | undefined;
  /** Round the grand total to the nearest rupee into the Round Off account. Default true. */
  roundOff?: boolean | undefined;
  /** The supplier's own invoice number and date (purchase and purchase return only). */
  partyBillNo?: string | undefined;
  partyBillDate?: string | undefined;
}

export interface JournalEntryInput {
  accountId: number;
  side: 'dr' | 'cr';
  amountPaise: Paise;
}

export interface EntryVoucherInput extends VoucherCommon {
  type: EntryVoucherType;
  partyAccountId?: number | undefined;
  entries: JournalEntryInput[];
}

export interface StockJournalLineInput {
  itemId: number;
  qty: Milli;
  unitId: number;
  /** 'out' = material issued, 'in' = material received. */
  direction: 'in' | 'out';
  /** Cost per unit of items received; required for 'in' lines so stock value stays right. */
  ratePaise?: Paise | undefined;
}

/** Moves stock between items (e.g. cutting a length into pieces). No accounts are touched. */
export interface StockJournalInput extends VoucherCommon {
  type: 'stock_journal';
  lines: StockJournalLineInput[];
}

export interface PhysicalStockLineInput {
  itemId: number;
  unitId: number;
  /** The quantity actually counted; the voucher posts the difference from the books. */
  countedQty: Milli;
}

/** A stock count: posts the difference between what was counted and what the books say. */
export interface PhysicalStockInput extends VoucherCommon {
  type: 'physical_stock';
  lines: PhysicalStockLineInput[];
}

export type StockVoucherInput = StockJournalInput | PhysicalStockInput;
export type VoucherInput = ItemVoucherInput | EntryVoucherInput | StockVoucherInput;

export const isStockInput = (input: VoucherInput): input is StockVoucherInput =>
  input.type === 'stock_journal' || input.type === 'physical_stock';
export const isItemInput = (input: VoucherInput): input is ItemVoucherInput =>
  !isStockInput(input) && 'lines' in input;

export interface PostOptions {
  now?: string;
  /** Who is posting. Staff are stopped by day close; the owner is not. Defaults to owner. */
  role?: 'owner' | 'staff';
  /**
   * For the Busy importer only: skip checks that real-world legacy data may fail (missing
   * original-invoice reference on returns/notes, missing or short HSN on sales). Everything
   * else, including balance and numbering, is still enforced.
   */
  legacyImport?: boolean;
}

export interface PostedVoucher {
  voucherId: number;
  number: number;
  totalPaise: Paise;
}

export class PostingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostingError';
  }
}

export class UnbalancedVoucherError extends PostingError {
  constructor(
    readonly debitPaise: Paise,
    readonly creditPaise: Paise,
  ) {
    super(`Voucher is not balanced: debits ${debitPaise} paise, credits ${creditPaise} paise`);
    this.name = 'UnbalancedVoucherError';
  }
}

/** What a printed bill shows about the shop, the party and the items, copied when the bill is posted. */
export interface VoucherSnapshot {
  company: {
    name: string;
    address: string;
    gstin: string | null;
    stateCode: string;
    phone: string | null;
    invoiceFooter: string;
  } | null;
  party: {
    name: string;
    address: string | null;
    phone: string | null;
    stateCode: string | null;
  } | null;
  /** Item names by item id. */
  items: Record<string, string>;
}
