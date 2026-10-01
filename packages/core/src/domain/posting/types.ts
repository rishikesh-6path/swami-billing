import type { BasisPoints, Milli, Paise } from '../../money.ts';

export type ItemVoucherType = 'sales' | 'sales_return' | 'purchase' | 'purchase_return';
export type EntryVoucherType =
  'receipt' | 'payment' | 'journal' | 'contra' | 'debit_note' | 'credit_note';
export type VoucherType = ItemVoucherType | EntryVoucherType;
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

export type VoucherInput = ItemVoucherInput | EntryVoucherInput;

export interface PostOptions {
  now?: string;
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
