import { useEffect, useState } from 'react';
import type { SessionState } from '../ipc/contract.ts';
import { Calculator } from './components/Calculator.tsx';
import { LockScreen } from './components/LockScreen.tsx';
import { Notice } from './components/ui.tsx';
import { ToastProvider } from './components/ui.tsx';
import { call } from './lib/api.ts';
import { HotkeyProvider, useCurrentHints, useHotkeys } from './lib/hotkeys.tsx';
import { RouterProvider, useRouter } from './lib/router.tsx';
import { SessionProvider } from './lib/session.tsx';
import { Home } from './screens/Home.tsx';
import { AuditScreen } from './screens/bills/AuditScreen.tsx';
import { BillList } from './screens/bills/BillList.tsx';
import { BillView } from './screens/bills/BillView.tsx';
import { ReportScreen } from './screens/reports/ReportScreen.tsx';
import { ReportsHub } from './screens/reports/ReportsHub.tsx';
import { ItemForm } from './screens/masters/ItemForm.tsx';
import { ItemList } from './screens/masters/ItemList.tsx';
import { PartyForm } from './screens/masters/PartyForm.tsx';
import { PartySummaryScreen } from './screens/masters/PartySummary.tsx';
import { PartyList } from './screens/masters/PartyList.tsx';
import { EntryRoute } from './screens/voucher/EntryRoute.tsx';
import { NoteVoucher } from './screens/voucher/NoteVoucher.tsx';
import { StockVoucher } from './screens/voucher/StockVoucher.tsx';
import { VoucherRoute } from './screens/voucher/VoucherRoute.tsx';
import { ImportScreen } from './screens/import/ImportScreen.tsx';
import { SettingsScreen } from './screens/settings/SettingsScreen.tsx';
import { Login } from './screens/Login.tsx';
import { Setup } from './screens/Setup.tsx';

function Screens(props: { session: SessionState; onSession: (s: SessionState) => void }) {
  const router = useRouter();
  const [calculating, setCalculating] = useState(false);
  const [locked, setLocked] = useState(false);
  const seconds = props.session.lockAfterSeconds;
  useHotkeys({ Escape: router.back, F10: () => setCalculating(true) });

  // lock the screen after a while without a key or a mouse movement
  useEffect(() => {
    if (seconds <= 0 || locked) return;
    const lock = () => setLocked(true);
    let timer = setTimeout(lock, seconds * 1000);
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, seconds * 1000);
    };
    const events = ['keydown', 'mousedown', 'mousemove', 'wheel'] as const;
    for (const name of events) window.addEventListener(name, bump, true);
    return () => {
      clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, bump, true);
    };
  }, [seconds, locked]);

  return (
    <>
      <Routes {...props} />
      {calculating && <Calculator onClose={() => setCalculating(false)} />}
      {locked && props.session.user && (
        <LockScreen
          userName={props.session.user.name}
          onUnlocked={() => setLocked(false)}
          onSwitchUser={() => {
            // the cover stays up until the sign-out has really happened
            call('auth.logout', {}).then(
              (next) => {
                setLocked(false);
                props.onSession(next);
              },
              () => undefined,
            );
          }}
        />
      )}
    </>
  );
}

function Routes({
  session,
  onSession,
}: {
  session: SessionState;
  onSession: (s: SessionState) => void;
}) {
  const router = useRouter();
  if (router.route.name === 'bills') return <BillList voucherType={router.route.voucherType} />;
  if (router.route.name === 'bill') return <BillView key={router.route.id} id={router.route.id} />;
  if (router.route.name === 'audit') return <AuditScreen />;
  if (router.route.name === 'import') return <ImportScreen />;
  if (router.route.name === 'settings')
    return <SettingsScreen initial={router.route.section} onSession={onSession} />;
  if (router.route.name === 'reports') return <ReportsHub />;
  if (router.route.name === 'report') {
    const r = router.route;
    return (
      <ReportScreen
        key={`${r.kind}-${r.accountId ?? ''}`}
        kind={r.kind}
        accountId={r.accountId}
        accountName={r.accountName}
        side={r.side}
      />
    );
  }
  if (router.route.name === 'items') return <ItemList />;
  if (router.route.name === 'item')
    return <ItemForm key={router.route.id ?? 'new'} id={router.route.id} />;
  if (router.route.name === 'parties')
    return <PartyList key={router.route.kind} kind={router.route.kind} />;
  if (router.route.name === 'partySummary') {
    return (
      <PartySummaryScreen key={router.route.id} id={router.route.id} kind={router.route.kind} />
    );
  }
  if (router.route.name === 'party') {
    const { kind, id } = router.route;
    return <PartyForm key={`${kind}-${id ?? 'new'}`} kind={kind} id={id} />;
  }
  if (router.route.name === 'entry') {
    const { kind, editId, party } = router.route;
    return (
      <EntryRoute
        key={`${kind}-${editId ?? 'new'}-${party?.id ?? ''}`}
        kind={kind}
        editId={editId}
        party={party}
      />
    );
  }
  if (router.route.name === 'stock') {
    return <StockVoucher key={router.route.kind} kind={router.route.kind} />;
  }
  if (router.route.name === 'note') {
    return <NoteVoucher key={router.route.kind} kind={router.route.kind} />;
  }
  if (router.route.name === 'voucher') {
    const { kind, editId, party } = router.route;
    return (
      <VoucherRoute
        key={`${kind}-${editId ?? 'new'}-${party?.id ?? ''}`}
        kind={kind}
        editId={editId}
        party={party}
      />
    );
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
