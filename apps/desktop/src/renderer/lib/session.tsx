import { createContext, useContext, type ReactNode } from 'react';
import type { SessionState } from '../../ipc/contract.ts';

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({
  session,
  children,
}: {
  session: SessionState;
  children: ReactNode;
}) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** Who is signed in, the shop, and today's date (the shop's date, not the computer clock). */
export function useSession(): SessionState {
  const session = useContext(SessionContext);
  if (!session) throw new Error('SessionProvider is missing');
  return session;
}
