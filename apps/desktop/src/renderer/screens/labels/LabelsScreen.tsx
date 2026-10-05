import { useEffect, useRef, useState } from 'react';
import type { ItemSearchRow } from '@shopledger/core';
import { Button, Card, Notice, PageHeader, useToast } from '../../components/ui.tsx';
import { Typeahead } from '../../components/Typeahead.tsx';
import { call } from '../../lib/api.ts';
import { formatQty, rupees } from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter } from '../../lib/router.tsx';
import { useSession } from '../../lib/session.tsx';

interface LabelRow {
  itemId: number;
  name: string;
  count: string;
}

/**
 * Plain price labels on A4 label sheets: pick items, say how many labels each, check the preview,
 * then print or save as PDF. Opened from the item list (one item) or a purchase bill (every line,
 * as many labels as were bought).
 */
export function LabelsScreen({
  itemIds,
  fromBill,
}: {
  itemIds?: number[] | undefined;
  fromBill?: number | undefined;
}) {
  const router = useRouter();
  const toast = useToast();
  const { today } = useSession();
  const [rows, setRows] = useState<LabelRow[]>([]);
  const [layout, setLayout] = useState<'3x8' | '4x10'>('3x8');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<{ html: string; labels: number; pages: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const countRefs = useRef(new Map<number, HTMLInputElement | null>());
  const focusAfterAdd = useRef<number | null>(null);
  const addBox = useRef<HTMLInputElement | null>(null);

  // start with what the screen was opened for
  useEffect(() => {
    let live = true;
    const load = async () => {
      const start: LabelRow[] = [];
      if (fromBill) {
        const bill = await call('voucher.get', { id: fromBill });
        for (const l of bill?.lines ?? []) {
          // whole units: one label per piece; metres and the like: one label for the line
          const count = l.qty % 1000 === 0 ? l.qty / 1000 : 1;
          const same = start.find((r) => r.itemId === l.itemId);
          if (same) same.count = String(Number(same.count) + count);
          else start.push({ itemId: l.itemId, name: l.itemName, count: String(count) });
        }
      }
      for (const id of itemIds ?? []) {
        const found = await call('item.get', { id });
        if (found) start.push({ itemId: id, name: found.item.name, count: '1' });
      }
      if (live) setRows(start);
    };
    load().catch(() => {
      if (live) setError('The items could not be loaded. Please add them here.');
    });
    return () => {
      live = false;
    };
  }, [itemIds, fromBill]);

  const request = () => {
    const items: { itemId: number; count: number }[] = [];
    for (const r of rows) {
      const n = Number(r.count.trim() || '0');
      if (!Number.isInteger(n) || n < 0 || n > 1000) return null;
      if (n > 0) items.push({ itemId: r.itemId, count: n });
    }
    return { items, layout };
  };
  const key = JSON.stringify(request());

  // the preview follows the list after a short pause
  useEffect(() => {
    const req = JSON.parse(key) as ReturnType<typeof request>;
    if (!req || req.items.length === 0) return;
    let live = true;
    const timer = setTimeout(() => {
      call('labels.preview', req).then(
        (p) => {
          if (live) {
            setPreview(p);
            setError(null);
          }
        },
        (e: unknown) => {
          if (live) setError(e instanceof Error ? e.message : 'The labels could not be shown.');
        },
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);
  const shown = preview && rows.some((r) => Number(r.count) > 0) ? preview : null;

  useEffect(() => {
    if (focusAfterAdd.current !== null) {
      countRefs.current.get(focusAfterAdd.current)?.select();
      focusAfterAdd.current = null;
    }
  }, [rows]);

  const checked = () => {
    const req = request();
    if (!req) {
      setError('The number of labels must be a whole number from 0 to 1000.');
      return null;
    }
    if (req.items.length === 0) {
      setError('Please add at least one item and how many labels.');
      return null;
    }
    return req;
  };
  const print = () => {
    const req = checked();
    if (!req || busy) return;
    setBusy(true);
    call('labels.print', req).then(
      ({ printed }) => {
        setBusy(false);
        if (printed) toast.show('The labels were sent to the printer.');
        else
          setError(
            'The labels were not printed. Please check the printer is on and has label sheets, or save them as a PDF.',
          );
      },
      (e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : 'The labels could not be printed.');
      },
    );
  };
  const savePdf = () => {
    const req = checked();
    if (!req) return;
    call('labels.pdf', req).then(
      ({ saved }) => {
        if (saved) toast.show(`Saved to ${saved}`);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'The PDF could not be saved.'),
    );
  };
  const add = (it: ItemSearchRow) => {
    setText('');
    setError(null);
    focusAfterAdd.current = it.id;
    setRows((rs) =>
      rs.some((r) => r.itemId === it.id)
        ? rs
        : [...rs, { itemId: it.id, name: it.name, count: '1' }],
    );
  };
  const remove = (itemId: number) => setRows((rs) => rs.filter((r) => r.itemId !== itemId));

  useHotkeys({ Escape: router.back, F2: print, 'Ctrl+S': savePdf });
  useHints(['Type an item to add it', 'F2 Print', 'Ctrl+S Save as PDF', 'Esc Back']);

  return (
    <main className="page">
      <PageHeader
        title="Print Labels"
        subtitle="Price labels for the shelf or the goods: name, code and price on each."
        actions={
          <>
            <Button onClick={router.back}>Back (Esc)</Button>
            <Button onClick={savePdf}>Save as PDF</Button>
            <Button variant="primary" disabled={busy} onClick={print}>
              {busy ? 'Printing...' : 'Print (F2)'}
            </Button>
          </>
        }
      />
      {error && <Notice>{error}</Notice>}
      <Card>
        <div className="field">
          <label>Add an item</label>
          <Typeahead<ItemSearchRow>
            ariaLabel="Add an item"
            autoFocus
            inputRef={(el: HTMLInputElement | null) => {
              addBox.current = el;
            }}
            text={text}
            onText={setText}
            search={(t) => call('item.search', { text: t, onDate: today, limit: 12 })}
            getKey={(it) => it.id}
            isExact={(it, t) => it.alias?.toLowerCase() === t.toLowerCase()}
            renderOption={(it) => (
              <>
                <span>
                  {it.name}
                  {it.alias ? <span className="opt-sub"> · {it.alias}</span> : null}
                </span>
                <span className="opt-sub">
                  {rupees(it.salePricePaise)} · stock {formatQty(it.stockQty)} {it.unitName}
                </span>
              </>
            )}
            onPick={add}
            onNoMatch={(t) => setError(`No item matches "${t}".`)}
          />
          <div className="field-note" />
        </div>
        <div className="field">
          <label htmlFor="label-layout">Label sheet</label>
          <select
            id="label-layout"
            value={layout}
            onChange={(e) => setLayout(e.target.value === '4x10' ? '4x10' : '3x8')}
          >
            <option value="3x8">24 labels a sheet (3 across, 8 down)</option>
            <option value="4x10">40 small labels a sheet (4 across, 10 down)</option>
          </select>
          <div className="field-note" />
        </div>
        {rows.length === 0 ? (
          <p className="muted">No items yet. Type an item name or code above.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Labels</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId}>
                  <td>{r.name}</td>
                  <td className="num">
                    <input
                      aria-label={`Labels for ${r.name}`}
                      inputMode="numeric"
                      ref={(el) => {
                        countRefs.current.set(r.itemId, el);
                      }}
                      value={r.count}
                      onKeyDown={(e) => {
                        // Enter goes back to add the next item
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addBox.current?.focus();
                        }
                      }}
                      onChange={(e) =>
                        setRows((rs) =>
                          rs.map((x) =>
                            x.itemId === r.itemId ? { ...x, count: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </td>
                  <td>
                    <Button onClick={() => remove(r.itemId)}>Remove</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {shown && (
        <>
          <p className="muted">
            {shown.labels} {shown.labels === 1 ? 'label' : 'labels'} on {shown.pages}{' '}
            {shown.pages === 1 ? 'sheet' : 'sheets'}.
          </p>
          <iframe
            title="Labels preview"
            tabIndex={-1}
            className="print-frame print-frame-a4"
            sandbox=""
            srcDoc={shown.html}
          />
        </>
      )}
    </main>
  );
}
