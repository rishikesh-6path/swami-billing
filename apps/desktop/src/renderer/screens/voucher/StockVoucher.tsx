import { useState } from 'react';
import type { ItemSearchRow } from '@shopledger/core';
import { Button, ConfirmDialog, Notice, PageHeader, useToast } from '../../components/ui.tsx';
import { DateField } from '../../components/DateField.tsx';
import { Typeahead } from '../../components/Typeahead.tsx';
import { call, useCall, useKept } from '../../lib/api.ts';
import { formatMoney, formatQty, parseMoney, parseQty } from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter } from '../../lib/router.tsx';
import { useSession } from '../../lib/session.tsx';
import { useCellFocus } from './cells.ts';

interface Line {
  key: number;
  item: ItemSearchRow | null;
  text: string;
  /** Stock journal: 'out' = issued, 'in' = received. */
  direction: 'in' | 'out';
  qty: string;
  rate: string;
}

let keySeed = 1;
const blank = (): Line => ({
  key: keySeed++,
  item: null,
  text: '',
  direction: 'out',
  qty: '',
  rate: '',
});

/**
 * Stock Journal: turn some items into others (for example cut a roll of wire into pieces).
 * Physical Stock: type what you counted on the shelf; the books are corrected to match.
 */
export function StockVoucher({ kind }: { kind: 'stock_journal' | 'physical_stock' }) {
  const physical = kind === 'physical_stock';
  const router = useRouter();
  const toast = useToast();
  const { today } = useSession();
  const cells = useCellFocus();
  const [date, setDate] = useState(today);
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const setup = useCall('voucher.setup', { type: kind, date });
  const ready = useKept(setup);

  const patch = (key: number, change: Partial<Line>) => {
    setDirty(true);
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)));
  };
  const after = (index: number) => {
    const line = lines[index]!;
    if (!physical && line.direction === 'in') return cells.focus(line.key, 'rate');
    const nextLine =
      lines[index + 1] ??
      (() => {
        const fresh = blank();
        setLines((ls) => [...ls, fresh]);
        return fresh;
      })();
    cells.focus(nextLine.key, 'item');
  };

  const save = async () => {
    if (saving || !ready) return;
    setError(null);
    const used = lines.filter((l) => l.item || l.text.trim() !== '' || l.qty !== '');
    if (used.length === 0) return setError('Please add at least one item.');
    const out: {
      itemId: number;
      unitId: number;
      qty: number;
      direction: 'in' | 'out';
      ratePaise?: number;
      countedQty: number;
    }[] = [];
    for (const [i, l] of used.entries()) {
      if (!l.item) return setError(`Line ${i + 1}: please pick the item from the list.`);
      const qty = parseQty(l.qty);
      if (qty === null || qty < 0 || (!physical && qty === 0))
        return setError(`Line ${i + 1}: please enter the quantity.`);
      if (l.item.unitDecimals === 0 && qty % 1000 !== 0)
        return setError(`Line ${i + 1}: ${l.item.name} is counted in whole ${l.item.unitName}.`);
      let ratePaise: number | undefined;
      if (!physical && l.direction === 'in') {
        const rate = parseMoney(l.rate);
        if (rate === null || rate < 0)
          return setError(
            `Line ${i + 1}: please enter the cost per ${l.item.unitName} of the items received.`,
          );
        ratePaise = rate;
      }
      out.push({
        itemId: l.item.id,
        unitId: l.item.unitId,
        qty,
        direction: l.direction,
        countedQty: qty,
        ...(ratePaise !== undefined ? { ratePaise } : {}),
      });
    }
    const common = {
      date,
      seriesId: ready.defaultSeriesId,
      ...(note.trim() ? { narration: note.trim() } : {}),
    };
    const input = physical
      ? {
          type: 'physical_stock' as const,
          ...common,
          lines: out.map((l) => ({ itemId: l.itemId, unitId: l.unitId, countedQty: l.countedQty })),
        }
      : {
          type: 'stock_journal' as const,
          ...common,
          lines: out.map((l) => ({
            itemId: l.itemId,
            unitId: l.unitId,
            qty: l.qty,
            direction: l.direction,
            ...(l.ratePaise !== undefined ? { ratePaise: l.ratePaise } : {}),
          })),
        };
    setSaving(true);
    try {
      const posted = await call('voucher.post', input);
      toast.show(`Saved. Number ${posted.number}.`);
      setLines([blank()]);
      setNote('');
      setDirty(false);
      setup.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong and nothing was saved.');
    } finally {
      setSaving(false);
    }
  };

  const leave = () => (dirty ? setConfirmExit(true) : router.back());
  useHotkeys({ F2: () => void save(), Escape: leave });
  useHints(['F2 Save', 'Esc Cancel', 'Enter Next box']);

  if (!ready)
    return (
      <main className="page">
        {setup.status === 'error' ? (
          <Notice>{setup.message}</Notice>
        ) : (
          <p className="muted">Getting things ready...</p>
        )}
      </main>
    );

  return (
    <main className="page">
      <PageHeader
        title={physical ? 'Physical Stock Count' : 'Stock Journal'}
        subtitle={
          physical
            ? 'Type the quantity you counted. The books are corrected to match your count.'
            : 'Show items used up (issued) and the items made from them (received).'
        }
        actions={
          <>
            <Button onClick={leave}>Cancel (Esc)</Button>
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving...' : 'Save (F2)'}
            </Button>
          </>
        }
      />
      {error && <Notice>{error}</Notice>}
      <div className="voucher-top journal-top">
        <DateField label="Date" value={date} today={today} onChange={setDate} />
      </div>
      <table className="data bill-grid stock-grid">
        <thead>
          <tr>
            <th className="c-no">#</th>
            <th>Item</th>
            {!physical && <th className="c-dir">Issued or received</th>}
            {physical && <th className="num c-money">In the books</th>}
            <th className="num c-money">{physical ? 'Counted' : 'Quantity'}</th>
            {physical && <th className="num c-money">Difference</th>}
            {!physical && <th className="num c-money">Cost per unit</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const counted = parseQty(l.qty);
            return (
              <tr key={l.key}>
                <td className="c-no">{i + 1}</td>
                <td>
                  <Typeahead<ItemSearchRow>
                    ariaLabel={`Item, line ${i + 1}`}
                    autoFocus={i === 0}
                    inputRef={(el: HTMLInputElement | null) => cells.set(`${l.key}:item`, el)}
                    text={l.text}
                    onText={(t) =>
                      patch(l.key, { text: t, item: l.item && t === l.item.name ? l.item : null })
                    }
                    search={(text) => call('item.search', { text, onDate: date, limit: 12 })}
                    getKey={(it) => it.id}
                    isExact={(it, t) => it.alias?.toLowerCase() === t.toLowerCase()}
                    renderOption={(it) => (
                      <>
                        <span>
                          {it.name}{' '}
                          {it.alias ? <span className="opt-sub">· {it.alias}</span> : null}
                        </span>
                        <span className="opt-sub">
                          stock {formatQty(it.stockQty)} {it.unitName}
                        </span>
                      </>
                    )}
                    onPick={(it) => {
                      patch(l.key, {
                        item: it,
                        text: it.name,
                        rate:
                          !physical && l.rate === '' && it.costPaise > 0
                            ? formatMoney(it.costPaise)
                            : l.rate,
                      });
                      cells.focus(l.key, physical ? 'qty' : 'dir');
                    }}
                    onNoMatch={(t) => setError(`Line ${i + 1}: no item matches "${t}".`)}
                    onEnterEmpty={() => cells.focusId('note')}
                  />
                </td>
                {!physical && (
                  <td>
                    <select
                      aria-label={`Issued or received, line ${i + 1}`}
                      ref={(el: HTMLSelectElement | null) =>
                        cells.set(`${l.key}:dir`, el as unknown as HTMLInputElement)
                      }
                      value={l.direction}
                      onChange={(e) =>
                        patch(l.key, { direction: e.target.value === 'in' ? 'in' : 'out' })
                      }
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          cells.focus(l.key, 'qty');
                        }
                      }}
                    >
                      <option value="out">Issued (used up)</option>
                      <option value="in">Received (made)</option>
                    </select>
                  </td>
                )}
                {physical && (
                  <td className="num muted-cell">{l.item ? formatQty(l.item.stockQty) : ''}</td>
                )}
                <td className="num">
                  <input
                    aria-label={`${physical ? 'Counted' : 'Quantity'}, line ${i + 1}`}
                    className="cell-input num"
                    inputMode="decimal"
                    ref={(el: HTMLInputElement | null) => cells.set(`${l.key}:qty`, el)}
                    value={l.qty}
                    onChange={(e) => patch(l.key, { qty: e.target.value })}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        after(i);
                      }
                    }}
                  />
                </td>
                {physical && (
                  <td className="num amount-cell">
                    {l.item && counted !== null ? formatQty(counted - l.item.stockQty) : ''}
                  </td>
                )}
                {!physical && (
                  <td className="num">
                    <input
                      aria-label={`Cost per unit, line ${i + 1}`}
                      className="cell-input num"
                      inputMode="decimal"
                      disabled={l.direction === 'out'}
                      ref={(el: HTMLInputElement | null) => cells.set(`${l.key}:rate`, el)}
                      value={l.direction === 'out' ? '' : l.rate}
                      onChange={(e) => patch(l.key, { rate: e.target.value })}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const fresh =
                            lines[i + 1] ??
                            (() => {
                              const f = blank();
                              setLines((ls) => [...ls, f]);
                              return f;
                            })();
                          cells.focus(fresh.key, 'item');
                        }
                      }}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="grid-actions">
        <Button
          onClick={() => {
            const fresh = blank();
            setLines((ls) => [...ls, fresh]);
            cells.focus(fresh.key, 'item');
          }}
        >
          Add another line
        </Button>
      </div>
      {!physical && (
        <p className="muted">
          The cost per unit of the items received is used to value your stock.
        </p>
      )}
      <div className="field">
        <label htmlFor="note">Note (optional)</label>
        <input
          id="note"
          ref={(el: HTMLInputElement | null) => cells.set('note', el)}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setDirty(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
          }}
        />
        <div className="field-note">Press Enter here to save.</div>
      </div>
      {confirmExit && (
        <ConfirmDialog
          title="Leave without saving?"
          confirmLabel="Yes, leave"
          cancelLabel="No, keep working"
          danger
          onConfirm={() => router.back()}
          onCancel={() => setConfirmExit(false)}
        >
          You have typed something that is not saved. If you leave now it will be lost.
        </ConfirmDialog>
      )}
    </main>
  );
}
