import { useState } from 'react';
import { Button, LoadState, PageHeader } from '../../components/ui.tsx';
import { useCall } from '../../lib/api.ts';
import { formatBalance } from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter, type PartyKind } from '../../lib/router.tsx';
import { useSession } from '../../lib/session.tsx';

export function PartyList({ kind }: { kind: PartyKind }) {
  const router = useRouter();
  const { today } = useSession();
  const [text, setText] = useState('');
  const [selected, setSelected] = useState(0);
  const parties = useCall('party.list', { kind, text, asOn: today });
  const rows = parties.status === 'ready' ? parties.data : [];
  const word = kind === 'customer' ? 'customer' : 'supplier';
  const add = () => router.go({ name: 'party', kind });
  const open = (id: number) => router.go({ name: 'partySummary', kind, id });
  useHotkeys({ F3: add });
  useHints([
    'Type to search',
    'Up/Down Choose',
    'Enter See the summary',
    `F3 Add ${word}`,
    'Esc Back',
  ]);

  return (
    <main className="page">
      <PageHeader
        title={kind === 'customer' ? 'Customers' : 'Suppliers'}
        subtitle={
          kind === 'customer' ? 'People and shops you sell to.' : 'People and shops you buy from.'
        }
        actions={
          <>
            <Button onClick={router.back}>Back (Esc)</Button>
            <Button variant="primary" onClick={add}>
              Add {word} (F3)
            </Button>
          </>
        }
      />
      <div className="field">
        <label htmlFor="party-search">Find a {word}</label>
        <input
          id="party-search"
          autoFocus
          autoComplete="off"
          placeholder="Name, phone or GST number"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, rows.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter' && rows[selected]) {
              e.preventDefault();
              open(rows[selected].id);
            }
          }}
        />
      </div>
      <LoadState state={parties}>
        {rows.length === 0 ? (
          <p className="muted">
            {text
              ? `No ${word} matches "${text}".`
              : `There are no ${word}s yet. Press F3 to add one.`}
          </p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>GST number</th>
                <th className="num">Credit days</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  className={`${i === selected ? 'row-selected' : ''} clickable`}
                  onClick={() => open(r.id)}
                >
                  <td>{r.name}</td>
                  <td>{r.phone}</td>
                  <td>{r.gstin}</td>
                  <td className="num">{r.creditDays}</td>
                  <td className="num">{formatBalance(r.balancePaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LoadState>
    </main>
  );
}
