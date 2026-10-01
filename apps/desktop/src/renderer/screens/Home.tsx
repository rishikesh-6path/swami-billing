import { useState } from 'react';
import type { SessionState } from '../../ipc/contract.ts';
import { Button, Card, InfoDialog, LoadState } from '../components/ui.tsx';
import { call, useCall } from '../lib/api.ts';
import { formatDate, rupees } from '../lib/format.ts';
import { useHints, useHotkeys } from '../lib/hotkeys.tsx';
import { useRouter } from '../lib/router.tsx';

export function Home({
  session,
  onSession,
}: {
  session: SessionState;
  onSession: (s: SessionState) => void;
}) {
  const router = useRouter();
  const summary = useCall('home.summary', {});
  const info = useCall('app.info', {});
  const [help, setHelp] = useState(false);
  const signOut = () => void call('auth.logout', {}).then(onSession);
  useHotkeys({ F1: () => setHelp(true), U: signOut });
  useHints(['F1 Help', 'U Switch user']);

  return (
    <main className="page">
      <header className="home-header">
        <div>
          <h1>{session.company?.name}</h1>
          <p className="muted">
            {formatDate(session.today)} &middot; Signed in as {session.user?.name}
          </p>
        </div>
        <Button onClick={signOut}>Switch user (U)</Button>
      </header>

      <LoadState state={summary}>
        {summary.status === 'ready' && (
          <div className="stat-row">
            <Card className="stat">
              <span className="stat-label">Sales today</span>
              <span className="stat-value">{rupees(summary.data.todaySalesPaise)}</span>
              <span className="muted">{summary.data.todayBills} bills</span>
            </Card>
            <Card className="stat">
              <span className="stat-label">Cash in hand</span>
              <span className="stat-value">{rupees(summary.data.cashInHandPaise)}</span>
            </Card>
            <Card className="stat">
              <span className="stat-label">To collect from customers</span>
              <span className="stat-value">{rupees(summary.data.toCollectPaise)}</span>
            </Card>
            <Card className="stat">
              <span className="stat-label">Items running low</span>
              <span className="stat-value">{summary.data.lowStockItems}</span>
            </Card>
          </div>
        )}
      </LoadState>

      <p className="muted">More screens are added here as they are built.</p>
      <Button onClick={() => router.go({ name: 'placeholder', title: 'Coming soon' })}>
        Coming soon
      </Button>

      {help && (
        <InfoDialog title="Keys you can use" onClose={() => setHelp(false)}>
          <ul className="keys">
            <li>
              <kbd>F1</kbd> Help
            </li>
            <li>
              <kbd>U</kbd> Switch user
            </li>
          </ul>
          <details>
            <summary>About this computer</summary>
            {info.status === 'ready' && (
              <dl>
                <dt>Data file location</dt>
                <dd data-testid="db-path">{info.data.dbPath}</dd>
                <dt>Data version</dt>
                <dd data-testid="schema-version">{info.data.schemaVersion}</dd>
              </dl>
            )}
          </details>
        </InfoDialog>
      )}
    </main>
  );
}
