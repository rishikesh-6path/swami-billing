import { useState } from 'react';
import { Button, LoadState, PageHeader } from '../../components/ui.tsx';
import { useCall } from '../../lib/api.ts';
import { formatPercent, rupees } from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter } from '../../lib/router.tsx';
import { useSession } from '../../lib/session.tsx';

export function ItemList() {
  const router = useRouter();
  const [text, setText] = useState('');
  const [selected, setSelected] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const items = useCall('item.list', { text, includeInactive: showHidden });
  const rows = items.status === 'ready' ? items.data : [];
  const add = () => router.go({ name: 'item' });
  const open = (id: number) => router.go({ name: 'item', id });

  const { user } = useSession();
  const isOwner = user?.role === 'owner';
  useHotkeys({
    F2: add,
    'Alt+L': () =>
      router.go({ name: 'labels', ...(rows[selected] ? { itemIds: [rows[selected].id] } : {}) }),
    ...(isOwner ? { 'Alt+P': () => router.go({ name: 'priceChange' }) } : {}),
  });
  useHints([
    'Type to search',
    'Up/Down Choose',
    'Enter Open',
    'F2 Add item',
    'Alt+L Print labels',
    ...(isOwner ? ['Alt+P Change prices'] : []),
    'Esc Back',
  ]);

  return (
    <main className="page">
      <PageHeader
        title="Items"
        subtitle="Everything you sell. Type a name or code to find an item."
        actions={
          <>
            <Button onClick={router.back}>Back (Esc)</Button>
            {isOwner && (
              <Button onClick={() => router.go({ name: 'priceChange' })}>
                Change prices (Alt+P)
              </Button>
            )}
            <Button variant="primary" onClick={add}>
              Add item (F2)
            </Button>
          </>
        }
      />
      <div className="field">
        <label htmlFor="item-search">Find an item</label>
        <input
          id="item-search"
          autoFocus
          autoComplete="off"
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
        <label className="check">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />{' '}
          Also show items that are not in use
        </label>
      </div>
      <LoadState state={items}>
        {rows.length === 0 ? (
          <p className="muted">
            {text
              ? `No item matches "${text}".`
              : 'There are no items yet. Press F2 to add your first item.'}
          </p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Item</th>
                <th>Group</th>
                <th>Unit</th>
                <th className="num">GST</th>
                <th className="num">Sale price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  className={`${i === selected ? 'row-selected' : ''} ${r.isActive ? '' : 'row-muted'} clickable`}
                  onClick={() => open(r.id)}
                >
                  <td>{r.alias}</td>
                  <td>{r.name}</td>
                  <td>{r.groupName}</td>
                  <td>{r.unitName}</td>
                  <td className="num">{r.rateBp === null ? 'not set' : formatPercent(r.rateBp)}</td>
                  <td className="num">{rupees(r.salePricePaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </LoadState>
    </main>
  );
}
