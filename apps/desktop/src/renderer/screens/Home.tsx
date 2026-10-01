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
  const open = (kind: 'sales' | 'purchase' | 'sales_return' | 'purchase_return') => () =>
    router.go({ name: 'voucher', kind });
  const entry = (kind: 'receipt' | 'payment' | 'journal' | 'contra') => () =>
    router.go({ name: 'entry', kind });
  const stock = (kind: 'stock_journal' | 'physical_stock') => () =>
    router.go({ name: 'stock', kind });
  useHotkeys({
    F1: () => setHelp(true),
    U: signOut,
    F5: entry('payment'),
    F6: entry('receipt'),
    F7: entry('journal'),
    F8: open('sales'),
    F9: open('purchase'),
  });
  useHints(['F8 Sale', 'F9 Purchase', 'F6 Receipt', 'F5 Payment', 'F1 Help', 'U Switch user']);

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

      <div className="tiles">
        <Tile title="New Sale" keyName="F8" onClick={open('sales')} />
        <Tile title="New Purchase" keyName="F9" onClick={open('purchase')} />
        <Tile title="Sales Return" onClick={open('sales_return')} />
        <Tile title="Purchase Return" onClick={open('purchase_return')} />
        <Tile title="Receipt (money in)" keyName="F6" onClick={entry('receipt')} />
        <Tile title="Payment (money out)" keyName="F5" onClick={entry('payment')} />
        <Tile title="Journal Entry" keyName="F7" onClick={entry('journal')} />
        <Tile title="Cash / Bank Transfer" onClick={entry('contra')} />
        <Tile title="Stock Journal" onClick={stock('stock_journal')} />
        <Tile title="Stock Count" onClick={stock('physical_stock')} />
      </div>

      {help && (
        <InfoDialog title="Keys you can use" onClose={() => setHelp(false)}>
          <ul className="keys">
            <li>
              <kbd>F1</kbd> Help
            </li>
            <li>
              <kbd>U</kbd> Switch user
            </li>
            <li>
              <kbd>F8</kbd> New sale
            </li>
            <li>
              <kbd>F9</kbd> New purchase
            </li>
            <li>
              <kbd>F6</kbd> New receipt
            </li>
            <li>
              <kbd>F5</kbd> New payment
            </li>
            <li>
              <kbd>F7</kbd> New journal entry
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

function Tile({
  title,
  keyName,
  onClick,
}: {
  title: string;
  keyName?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="tile" onClick={onClick}>
      <span className="tile-title">{title}</span>
      {keyName && <span className="tile-key">Press {keyName}</span>}
    </button>
  );
}
