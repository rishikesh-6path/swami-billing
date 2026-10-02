import { createContext, useContext, useState, type ReactNode } from 'react';

export type ItemVoucherKind = 'sales' | 'purchase' | 'sales_return' | 'purchase_return';

export type EntryKind = 'receipt' | 'payment' | 'journal' | 'contra';
export type StockKind = 'stock_journal' | 'physical_stock';

/** A customer or supplier a new bill or entry starts with (from their summary page). */
export interface StartParty {
  id: number;
  name: string;
  stateCode: string | null;
}

export type PartyKind = 'customer' | 'supplier';

export type ReportKind =
  | 'ledger'
  | 'stock'
  | 'itemLedger'
  | 'trialBalance'
  | 'dayBook'
  | 'daySummary'
  | 'outstanding'
  | 'salesRegister'
  | 'purchaseRegister'
  | 'gstSummary'
  | 'gstr1'
  | 'gstr3b'
  | 'purchasesForCa'
  | 'reorder'
  | 'profitAndLoss'
  | 'balanceSheet';

export type Route =
  | { name: 'bills'; voucherType?: string }
  | { name: 'bill'; id: number }
  | { name: 'audit' }
  | { name: 'import' }
  | {
      name: 'settings';
      section?: 'shop' | 'print' | 'users' | 'notes' | 'closing' | 'backup' | 'support';
    }
  | { name: 'reports' }
  | {
      name: 'report';
      kind: ReportKind;
      accountId?: number;
      accountName?: string;
      side?: 'receivable' | 'payable';
    }
  | { name: 'items' }
  | { name: 'item'; id?: number }
  | { name: 'parties'; kind: PartyKind }
  | { name: 'party'; kind: PartyKind; id?: number }
  | { name: 'partySummary'; id: number; kind: PartyKind }
  | { name: 'entry'; kind: EntryKind; editId?: number; party?: StartParty }
  | { name: 'stock'; kind: StockKind }
  | { name: 'home' }
  | { name: 'voucher'; kind: ItemVoucherKind; editId?: number; party?: StartParty }
  | { name: 'note'; kind: 'credit_note' | 'debit_note' }
  | { name: 'placeholder'; title: string };

interface RouterApi {
  route: Route;
  go: (route: Route) => void;
  /** Goes back one screen; does nothing on the home screen. */
  back: () => void;
  home: () => void;
}

const RouterContext = createContext<RouterApi | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const api: RouterApi = {
    route: stack[stack.length - 1]!,
    go: (route) => setStack((s) => [...s, route]),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
    home: () => setStack([{ name: 'home' }]),
  };
  return <RouterContext.Provider value={api}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterApi {
  const api = useContext(RouterContext);
  if (!api) throw new Error('RouterProvider is missing');
  return api;
}
