import { useEffect, useRef, useState } from 'react';
import type { ItemSearchRow } from '@shopledger/core';
import { Button, Card, ConfirmDialog, Notice, PageHeader, useToast } from '../../components/ui.tsx';
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

/** From a purchase bill, an item bought in large numbers starts with this many labels. */
const PER_ITEM_START = 100;
const MAX_PER_ITEM = 1000;

const countOf = (r: LabelRow) => Number(r.count.trim() || '0');
const countOk = (r: LabelRow) => {
  const n = countOf(r);
  return Number.isInteger(n) && n >= 0 && n <= MAX_PER_ITEM;
};

/**
 * Plain price labels on A4 label sheets: pick items, say how many labels each, check the preview,
 * then print or save as PDF. Opened from the item list (one item) or a purchase bill (every line,
 * one label per piece).
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
  const [preview, setPreview] = useState<{
    html: string;
    labels: number;
    pages: number;
    /** The list it was made for: a preview of an older list is never shown. */
    key: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(Boolean(fromBill || itemIds?.length));
  const [dirty, setDirty] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const saving = useRef(false);
  const countRefs = useRef(new Map<number, HTMLInputElement | null>());
  const focusAfterAdd = useRef<number | null>(null);
  const addBox = useRef<HTMLInputElement | null>(null);

  // start with what the screen was opened for
  useEffect(() => {
    let live = true;
    const load = async () => {
      const start: LabelRow[] = [];
      let capped = false;
      if (fromBill) {
        const bill = await call('voucher.get', { id: fromBill });
        for (const l of bill?.lines ?? []) {
          // whole units: one label per piece; metres and the like: one label for the line
          const wanted = l.qty % 1000 === 0 ? l.qty / 1000 : 1;
          const same = start.find((r) => r.itemId === l.itemId);
          const total = (same ? Number(same.count) : 0) + wanted;
          capped ||= total > PER_ITEM_START;
          const count = String(Math.min(total, PER_ITEM_START));
          if (same) same.count = count;
          else start.push({ itemId: l.itemId, name: l.itemName, count });
        }
      }
      for (const id of itemIds ?? []) {
        const found = await call('item.get', { id });
        if (found && !start.some((r) => r.itemId === id))
          start.push({ itemId: id, name: found.item.name, count: '1' });
      }
      if (!live) return;
      // anything added while the lines were loading is kept after them
      setRows((typed) => [
        ...start,
        ...typed.filter((t) => !start.some((x) => x.itemId === t.itemId)),
      ]);
      setLoading(false);
      if (capped) {
        setNote(
          `Some items were bought in large numbers; their labels start at ${PER_ITEM_START}. Change the numbers if you need more or fewer.`,
        );
      }
    };
    load().catch(() => {
      if (!live) return;
      setLoading(false);
      setError('The items could not be loaded. Please add them here.');
    });
    return () => {
      live = false;
    };
  }, [itemIds, fromBill]);

  const badRow = rows.find((r) => !countOk(r));
  const items = rows
    .filter((r) => countOf(r) > 0)
    .map((r) => ({ itemId: r.itemId, count: countOf(r) }));
  const key = JSON.stringify({ items, layout });

  // the preview follows the list after a short pause, and only for a list that can be printed
  useEffect(() => {
    if (badRow) return;
    const req = JSON.parse(key) as {
      items: { itemId: number; count: number }[];
      layout: '3x8' | '4x10';
    };
    if (req.items.length === 0) return;
    let live = true;
    const timer = setTimeout(() => {
      call('labels.preview', req).then(
        (p) => {
          if (!live) return;
          setPreview({ ...p, key });
          setError(null);
        },
        (e: unknown) => {
          if (!live) return;
          setPreview(null);
          setError(e instanceof Error ? e.message : 'The labels could not be shown.');
        },
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, badRow]);
  const shown = !badRow && preview && preview.key === key ? preview : null;

  useEffect(() => {
    if (focusAfterAdd.current !== null) {
      countRefs.current.get(focusAfterAdd.current)?.select();
      focusAfterAdd.current = null;
    }
  }, [rows]);

  /** The list as it will be printed, or null with a message saying what to fix. */
  const checked = () => {
    if (badRow) {
      setError(
        `The number of labels for ${badRow.name} must be a whole number from 0 to ${MAX_PER_ITEM}.`,
      );
      countRefs.current.get(badRow.itemId)?.select();
      return null;
    }
    if (items.length === 0) {
      setError('Please add at least one item and how many labels.');
      return null;
    }
    return { items, layout };
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
            'The labels were not printed. If you closed the print window, nothing is wrong; otherwise please check the printer is on and has label sheets, or save them as a PDF.',
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
    if (!req || saving.current) return;
    saving.current = true;
    call('labels.pdf', req)
      .then(
        ({ saved }) => {
          if (saved) toast.show(`Saved to ${saved}`);
        },
        (e: unknown) => setError(e instanceof Error ? e.message : 'The PDF could not be saved.'),
      )
      .finally(() => {
        saving.current = false;
      });
  };
  const add = (it: ItemSearchRow) => {
    setText('');
    setError(null);
    setDirty(true);
    if (rows.some((r) => r.itemId === it.id)) {
      // already in the list: go to its number instead of adding it twice
      countRefs.current.get(it.id)?.select();
      return;
    }
    focusAfterAdd.current = it.id;
    setRows((rs) => [...rs, { itemId: it.id, name: it.name, count: '1' }]);
  };
  const remove = (itemId: number) => {
    setDirty(true);
    setRows((rs) => rs.filter((r) => r.itemId !== itemId));
    addBox.current?.focus();
  };
  // F9 takes out the item whose number the cursor is in, as on a bill
  const removeCurrent = () => {
    for (const [itemId, el] of countRefs.current) {
      if (el && el === document.activeElement) return remove(itemId);
    }
  };
  const leave = () => (dirty && rows.length > 0 ? setConfirmLeave(true) : router.back());

  useHotkeys(
    confirmLeave
      ? {}
      : { Escape: leave, F2: print, 'Ctrl+P': print, 'Ctrl+S': savePdf, F9: removeCurrent },
  );
  useHints([
    'Type an item to add it',
    'F9 Take out item',
    'F2 Print',
    'Ctrl+S Save as PDF',
    'Esc Back',
  ]);

  return (
    <main className="page">
      <PageHeader
        title="Print Labels"
        subtitle="Price labels for the shelf or the goods: name, code and price with GST on each."
        actions={
          <>
            <Button onClick={leave}>Back (Esc)</Button>
            <Button onClick={savePdf}>Save as PDF (Ctrl+S)</Button>
            <Button variant="primary" disabled={busy} onClick={print}>
              {busy ? 'Printing...' : 'Print (F2)'}
            </Button>
          </>
        }
      />
      {error && <Notice>{error}</Notice>}
      {note && <Notice kind="info">{note}</Notice>}
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
            onText={(t) => {
              setText(t);
              setError(null);
            }}
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
            onNoMatch={(t) =>
              setError(`No item matches "${t}". Please check the name or code and try again.`)
            }
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
            <option value="3x8">24 labels a sheet, 70 x 37 mm (3 across, 8 down)</option>
            <option value="4x10">
              40 small labels a sheet, 52.5 x 29.7 mm (4 across, 10 down)
            </option>
          </select>
          <div className="field-note">Use label sheets with no border round the edge.</div>
        </div>
        {loading ? (
          <p className="muted">Getting the items...</p>
        ) : rows.length === 0 ? (
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
                      aria-invalid={countOk(r) ? undefined : true}
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
                      onChange={(e) => {
                        setDirty(true);
                        const value = e.target.value;
                        setRows((rs) =>
                          rs.map((x) => (x.itemId === r.itemId ? { ...x, count: value } : x)),
                        );
                      }}
                    />
                  </td>
                  <td>
                    <Button onClick={() => remove(r.itemId)}>Take out</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {badRow && (
          <p className="field-note field-error-text">
            The number of labels for {badRow.name} must be a whole number from 0 to {MAX_PER_ITEM}.
          </p>
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
            className="print-frame labels-frame"
            sandbox=""
            srcDoc={shown.html}
          />
        </>
      )}
      {confirmLeave && (
        <ConfirmDialog
          title="Leave the labels?"
          confirmLabel="Yes, leave"
          cancelLabel="No, stay"
          danger
          onConfirm={() => router.back()}
          onCancel={() => setConfirmLeave(false)}
        >
          The list of labels will be lost.
        </ConfirmDialog>
      )}
    </main>
  );
}
