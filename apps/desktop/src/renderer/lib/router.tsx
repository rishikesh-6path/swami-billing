import { createContext, useContext, useState, type ReactNode } from 'react';

export type ItemVoucherKind = 'sales' | 'purchase' | 'sales_return' | 'purchase_return';

export type Route =
  | { name: 'home' }
  | { name: 'voucher'; kind: ItemVoucherKind; editId?: number }
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
