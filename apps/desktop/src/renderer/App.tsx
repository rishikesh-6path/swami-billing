import { useEffect, useState } from 'react';
import type { SessionState } from '../ipc/contract.ts';
import { Notice } from './components/ui.tsx';
import { ToastProvider } from './components/ui.tsx';
import { call } from './lib/api.ts';
import { HotkeyProvider, useCurrentHints, useHotkeys } from './lib/hotkeys.tsx';
import { RouterProvider, useRouter } from './lib/router.tsx';
import { SessionProvider } from './lib/session.tsx';
import { Home } from './screens/Home.tsx';
import { EntryRoute } from './screens/voucher/EntryRoute.tsx';
import { StockVoucher } from './screens/voucher/StockVoucher.tsx';
import { VoucherRoute } from './screens/voucher/VoucherRoute.tsx';
import { Login } from './screens/Login.tsx';
import { Setup } from './screens/Setup.tsx';

function Screens({
  session,
  onSession,
}: {
  session: SessionState;
  onSession: (s: SessionState) => void;
}) {
  const router = useRouter();
  useHotkeys({ Escape: router.back });
  if (router.route.name === 'entry') {
    const { kind, editId } = router.route;
    return <EntryRoute key={`${kind}-${editId ?? 'new'}`} kind={kind} editId={editId} />;
  }
  if (router.route.name === 'stock') {
    return <StockVoucher key={router.route.kind} kind={router.route.kind} />;
  }
  if (router.route.name === 'voucher') {
    const { kind, editId } = router.route;
    return <VoucherRoute key={`${kind}-${editId ?? 'new'}`} kind={kind} editId={editId} />;
  }
  if (router.route.name === 'placeholder') {
    return (
      <main className="page">
        <h1>{router.route.title}</h1>
        <p className="muted">This screen is not ready yet. Press Esc to go back.</p>
      </main>
    );
  }
  return <Home session={session} onSession={onSession} />;
}

function StatusBar() {
  const hints = useCurrentHints();
  return (
    <footer className="status-bar" aria-label="Keys that work on this screen">
      {hints.map((h) => (
        <span key={h}>{h}</span>
      ))}
    </footer>
  );
}

export function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call('session.state', {}).then(setSession, (e: unknown) =>
      setError(e instanceof Error ? e.message : 'Something went wrong while starting up.'),
    );
  }, []);

  let body;
  if (error) {
    body = (
      <main className="centered">
        <Notice>
          {error} Please close ShopLedger and open it again. If this keeps happening, call support
          and do not enter new bills.
        </Notice>
      </main>
    );
  } else if (!session) {
    body = (
      <main className="centered">
        <p className="muted">Getting things ready...</p>
      </main>
    );
  } else if (!session.setupComplete) {
    body = <Setup onDone={setSession} />;
  } else if (!session.user) {
    body = <Login shopName={session.company?.name ?? 'ShopLedger'} onDone={setSession} />;
  } else {
    body = (
      <SessionProvider session={session}>
        <RouterProvider>
          <Screens session={session} onSession={setSession} />
        </RouterProvider>
      </SessionProvider>
    );
  }

  return (
    <HotkeyProvider>
      <ToastProvider>
        {body}
        <StatusBar />
      </ToastProvider>
    </HotkeyProvider>
  );
}
