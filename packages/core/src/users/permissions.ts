import type { Role } from '../books/control.ts';

export type Action =
  | 'bill' // make sales, purchases, receipts, payments and the other vouchers
  | 'cancel_voucher' // still subject to day close and the books lock
  | 'edit_masters' // items, customers, suppliers
  | 'view_daily_reports' // ledger, stock, outstanding, day book, registers
  | 'view_profit_and_loss'
  | 'view_balance_sheet'
  | 'view_gst'
  | 'close_day'
  | 'lock_books'
  | 'manage_users'
  | 'manage_settings'
  | 'backup_restore'
  | 'view_audit_log'
  | 'post_adjustments' // journal, stock journal, stock count, debit/credit notes
  | 'edit_openings' // opening balances and opening stock
  | 'change_prices' // change the selling prices of many items at once
  | 'close_year';

const STAFF: Action[] = ['bill', 'cancel_voucher', 'edit_masters', 'view_daily_reports'];

/** Owners can do everything. Staff bill, cancel (until the day is closed), and see daily reports. */
export function can(role: Role, action: Action): boolean {
  return role === 'owner' || STAFF.includes(action);
}
