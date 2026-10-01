import { useEffect, useState } from 'react';
import type { Res } from '../ipc/contract.ts';

type Info = Res<'app.info'>;
type State = { status: 'loading' } | { status: 'ready'; info: Info } | { status: 'failed' };

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    window.shopledger
      .invoke('app.info', {})
      .then((info) => setState({ status: 'ready', info }))
      .catch(() => setState({ status: 'failed' }));
  }, []);

  return (
    <main>
      <h1>ShopLedger</h1>
      {state.status === 'loading' && <p>Getting things ready...</p>}
      {state.status === 'failed' && (
        <p role="alert">
          Something went wrong while starting up. Please close ShopLedger and open it again. If this
          keeps happening, call support and do not enter new bills.
        </p>
      )}
      {state.status === 'ready' && (
        <>
          <p>Your shop data is ready. Billing and accounts will appear here.</p>
          <details>
            <summary>About this computer</summary>
            <dl>
              <dt>Data file location</dt>
              <dd data-testid="db-path">{state.info.dbPath}</dd>
              <dt>Data version</dt>
              <dd data-testid="schema-version">{state.info.schemaVersion}</dd>
            </dl>
          </details>
        </>
      )}
    </main>
  );
}
