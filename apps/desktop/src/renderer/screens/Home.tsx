import { useState } from 'react';
import type { SessionState } from '../../ipc/contract.ts';
import { Button, Card, InfoDialog, LoadState, Notice } from '../components/ui.tsx';
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
  const isOwner = session.user?.role === 'owner';
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
    ...(session.user?.role === 'owner'
      ? {
          T: () => router.go({ name: 'report', kind: 'trialBalance' }),
          B: () => router.go({ name: 'report', kind: 'balanceSheet' }),
          V: () => router.go({ name: 'report', kind: 'gstSummary' }),
        }
      : {}),
    L: () => router.go({ name: 'report', kind: 'ledger' }),
    A: () => router.go({ name: 'report', kind: 'outstanding' }),
    I: () => router.go({ name: 'items' }),
    S: () => router.go({ name: 'report', kind: 'stock' }),
    G: () => router.go({ name: 'report', kind: 'itemLedger' }),
    R: () => router.go({ name: 'reports' }),
    'Alt+B': () => router.go({ name: 'bills', voucherType: 'sales' }),
    D: () => router.go({ name: 'bills' }),
    F2: () => router.go({ name: 'item' }),
    F3: () => router.go({ name: 'party', kind: 'customer' }),
    F5: entry('payment'),
    F6: entry('receipt'),
    ...(isOwner ? { F7: entry('journal') } : {}),
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
        {summary.status === 'ready' && summary.data.heldBills > 0 && (
          <Notice kind="info">
            {summary.data.heldBills === 1
              ? 'One bill is set aside.'
              : `${summary.data.heldBills} bills are set aside.`}{' '}
            Open the same bill screen and press Alt+R to bring it back.
          </Notice>
        )}
        {summary.status === 'ready' && summary.data.backupWarning && (
          <Notice kind="info">{summary.data.backupWarning}</Notice>
        )}
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
        {isOwner && <Tile title="Journal Entry" keyName="F7" onClick={entry('journal')} />}
        <Tile title="Cash / Bank Transfer" onClick={entry('contra')} />
        {isOwner && (
          <Tile
            title="Credit Note (reduce a sale)"
            onClick={() => router.go({ name: 'note', kind: 'credit_note' })}
          />
        )}
        {isOwner && (
          <Tile
            title="Debit Note (reduce a purchase)"
            onClick={() => router.go({ name: 'note', kind: 'debit_note' })}
          />
        )}
        {isOwner && <Tile title="Stock Journal" onClick={stock('stock_journal')} />}
        {isOwner && <Tile title="Stock Count" onClick={stock('physical_stock')} />}
        <Tile title="Find a Bill" keyName="D" onClick={() => router.go({ name: 'bills' })} />
        {session.user?.role === 'owner' && (
          <Tile title="Who Did What" onClick={() => router.go({ name: 'audit' })} />
        )}
        {session.user?.role === 'owner' && (
          <Tile title="Add from a Spreadsheet" onClick={() => router.go({ name: 'import' })} />
        )}
        {session.user?.role === 'owner' && (
          <Tile title="Settings" onClick={() => router.go({ name: 'settings' })} />
        )}
        <Tile title="Reports" keyName="R" onClick={() => router.go({ name: 'reports' })} />
        <Tile title="Items" keyName="F2 adds" onClick={() => router.go({ name: 'items' })} />
        <Tile
          title="Customers"
          keyName="F3 adds"
          onClick={() => router.go({ name: 'parties', kind: 'customer' })}
        />
        <Tile title="Suppliers" onClick={() => router.go({ name: 'parties', kind: 'supplier' })} />
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
            <li>
              <kbd>F2</kbd> Add an item
            </li>
            <li>
              <kbd>F3</kbd> Add a customer
            </li>
            <li>
              <kbd>R</kbd> Reports
            </li>
            <li>
              <kbd>D</kbd> Find a bill, <kbd>Alt+B</kbd> Find a sale to change
            </li>
            <li>
              <kbd>L</kbd> Account ledger, <kbd>S</kbd> Stock, <kbd>G</kbd> Item history
            </li>
            <li>
              <kbd>A</kbd> Who owes whom (outstanding), <kbd>I</kbd> Items list
            </li>
            <li>
              <kbd>T</kbd> Trial balance, <kbd>B</kbd> Balance sheet, <kbd>V</kbd> GST summary
              (owner)
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
