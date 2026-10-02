import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ItemSearchRow, PartyHit, VoucherPreview } from '@shopledger/core';
import { DateField } from '../../components/DateField.tsx';
import { Typeahead } from '../../components/Typeahead.tsx';
import { Button, Card, ConfirmDialog, Notice, PageHeader, useToast } from '../../components/ui.tsx';
import { call, useCall, useKept } from '../../lib/api.ts';
import {
  formatBalance,
  formatDate,
  formatMoney,
  formatPercent,
  parseMoney,
  rupees,
} from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter } from '../../lib/router.tsx';
import { useSession } from '../../lib/session.tsx';
import { useCellFocus } from './cells.ts';

interface NoteRow {
  key: number;
  item: ItemSearchRow | null;
  text: string;
  value: string;
}
let seed = 1;
const blank = (): NoteRow => ({ key: seed++, item: null, text: '', value: '' });
const isBlank = (r: NoteRow) => r.item === null && r.text.trim() === '' && r.value.trim() === '';

const KINDS = {
  credit_note: {
    title: 'New Credit Note',
    explain:
      'Use this when a customer is owed money back on an earlier bill without goods coming back, for example a rate difference or a discount agreed later. The GST on the bill is reduced too.',
    partyLabel: 'Customer',
    partyKind: 'customer' as const,
    against: 'sales' as const,
    billLabel: 'Bill being corrected',
  },
  debit_note: {
    title: 'New Debit Note',
    explain:
      'Use this when a supplier gives you a price reduction on an earlier purchase without goods going back. Your claim of GST on that purchase is reduced too.',
    partyLabel: 'Supplier',
    partyKind: 'supplier' as const,
    against: 'purchase' as const,
    billLabel: 'Purchase being corrected',
  },
};

/**
 * A credit or debit note: a value (and the item it is about, for its HSN and GST rate) taken off an
 * earlier bill. No stock moves. The GST rate is the one the original bill charged.
 */
export function NoteVoucher({ kind: kindName }: { kind: 'credit_note' | 'debit_note' }) {
  const kind = KINDS[kindName];
  const router = useRouter();
  const toast = useToast();
  const { today } = useSession();
  const cells = useCellFocus();
  const [date, setDate] = useState(today);
  const [party, setParty] = useState<PartyHit | null>(null);
  const [partyText, setPartyText] = useState<string | null>(null);
  const [refId, setRefId] = useState<number | null>(null);
  const [taxMode, setTaxMode] = useState<'local' | 'interstate' | 'exempt'>('local');
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<NoteRow[]>([blank()]);
  const [loadedPreview, setPreview] = useState<VoucherPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const setup = useCall('voucher.setup', { type: kindName, date });
  const ready = useKept(setup);
  const bills = useCall('voucher.list', {
    voucherType: kind.against,
    ...(party ? { partyId: party.id } : {}),
  });

  // the bill list is switched on by picking the party, so move there once it is enabled
  const wantBillFocus = useRef(false);
  const latestPick = useRef(0);
  useEffect(() => {
    if (party && wantBillFocus.current) {
      wantBillFocus.current = false;
      document.getElementById('note-bill')?.focus();
    }
  }, [party]);
  const touch = () => setDirty(true);
  // nothing to total until at least one item is picked
  const hasLines = rows.some((r) => r.item);
  const preview = hasLines ? loadedPreview : null;
  const draftLines = rows
    .filter((r) => r.item)
    .map((r) => ({
      itemId: r.item!.id,
      qty: 1000,
      unitId: r.item!.unitId,
      listPricePaise: parseMoney(r.value) ?? 0,
    }));
  const previewKey = JSON.stringify({
    type: kindName,
    date,
    taxMode,
    partyAccountId: party?.id,
    ...(refId ? { refVoucherId: refId } : {}),
    lines: draftLines,
    roundOff: true,
  });
  useEffect(() => {
    if (!ready || draftLines.length === 0) return;
    let stale = false;
    const timer = setTimeout(() => {
      call('voucher.preview', JSON.parse(previewKey) as never).then(
        (p) => {
          if (!stale) setPreview(p);
        },
        () => undefined,
      );
    }, 120);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, ready]);

  const chooseBill = (id: number | null) => {
    setRefId(id);
    touch();
    if (!id) return;
    // the note follows the way the bill was made (within the state, between states, or no GST)
    const mine = ++latestPick.current;
    void call('voucher.get', { id }).then((d) => {
      // a quicker second pick must not be overwritten by the first answer arriving late
      if (d && mine === latestPick.current) setTaxMode(d.taxMode);
    });
  };

  const save = async () => {
    if (!ready || saving) return;
    setError(null);
    if (!party) return setError(`Please choose the ${kind.partyLabel.toLowerCase()}.`);
    if (!refId) return setError(`Please choose the ${kind.billLabel.toLowerCase()}.`);
    if (!reason.trim()) {
      document.getElementById('note-reason')?.focus();
      return setError('Please write the reason for this note.');
    }
    const lines: { itemId: number; qty: number; unitId: number; listPricePaise: number }[] = [];
    for (const [i, r] of rows.entries()) {
      if (isBlank(r)) continue;
      if (!r.item) return setError(`Row ${i + 1}: please pick the item from the list.`);
      const value = parseMoney(r.value);
      if (value === null || value <= 0) {
        cells.focus(r.key, 'value');
        return setError(`Row ${i + 1}: please enter the amount before GST.`);
      }
      lines.push({ itemId: r.item.id, qty: 1000, unitId: r.item.unitId, listPricePaise: value });
    }
    if (lines.length === 0) return setError('Please add at least one item with an amount.');
    setSaving(true);
    try {
      const posted = await call('voucher.post', {
        type: kindName,
        date,
        seriesId: ready.defaultSeriesId,
        partyAccountId: party.id,
        refVoucherId: refId,
        taxMode,
        narration: reason.trim(),
        lines,
        roundOff: true,
      });
      toast.show(
        `Saved. ${kind.title.replace('New ', '')} number ${posted.number}, total ${rupees(posted.totalPaise)}.`,
      );
      setDirty(false);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong and nothing was saved.');
    } finally {
      setSaving(false);
    }
  };

  const leave = () => (dirty ? setConfirmExit(true) : router.back());
  useHotkeys({ F2: () => void save(), Escape: leave });
  useHints(['F2 Save', 'Esc Cancel', 'Enter Next box']);

  const updateRow = (key: number, patch: Partial<NoteRow>) => {
    touch();
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };
  const nextRow = (index: number) => {
    const next = rows[index + 1];
    if (next) return cells.focus(next.key, 'item');
    const fresh = blank();
    flushSync(() => setRows((rs) => [...rs, fresh]));
    cells.focus(fresh.key, 'item');
  };
  const prefix = ready?.series.find((s) => s.id === ready.defaultSeriesId)?.prefix ?? '';

  if (!ready) {
    return (
      <main className="page voucher-page">
        {setup.status === 'error' ? <Notice>{setup.message}</Notice> : <p>Getting it ready...</p>}
      </main>
    );
  }
  return (
    <main className="page voucher-page">
      <PageHeader
        title={kind.title}
        subtitle={`Number ${prefix}${ready.nextNumber}`}
        actions={
          <>
            <Button onClick={leave}>Cancel (Esc)</Button>
            <Button variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving...' : 'Save (F2)'}
            </Button>
          </>
        }
      />
      <p className="muted">{kind.explain}</p>
      {error && <Notice>{error}</Notice>}

      <div className="voucher-top">
        <div className="field">
          <label>{kind.partyLabel}</label>
          <Typeahead<PartyHit>
            ariaLabel={kind.partyLabel}
            autoFocus
            text={partyText ?? party?.name ?? ''}
            onText={(t) => {
              setPartyText(t);
              setParty(null);
              setRefId(null);
              touch();
            }}
            search={(text) => call('party.search', { text, kind: kind.partyKind, asOn: date })}
            getKey={(p) => p.id}
            isExact={(p, t) => p.name.toLowerCase() === t.toLowerCase()}
            renderOption={(p) => (
              <>
                <span>{p.name}</span>
                <span className="opt-sub">{formatBalance(p.balancePaise)}</span>
              </>
            )}
            onPick={(p) => {
              setParty(p);
              setPartyText(null);
              setRefId(null);
              touch();
              wantBillFocus.current = true;
            }}
            onNoMatch={(t) => setError(`No ${kind.partyLabel.toLowerCase()} named "${t}".`)}
          />
          <div className="field-note" />
        </div>
        <DateField
          label="Date"
          value={date}
          today={today}
          onChange={(d) => {
            setDate(d);
            touch();
          }}
        />
        <div className="field">
          <label htmlFor="note-bill">{kind.billLabel}</label>
          <select
            id="note-bill"
            value={refId ?? ''}
            disabled={!party}
            onChange={(e) => chooseBill(e.target.value ? Number(e.target.value) : null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('note-reason')?.focus();
              }
            }}
          >
            <option value="">{party ? 'Choose the bill...' : 'Choose the party first'}</option>
            {bills.status === 'ready' &&
              bills.data.map((b) => (
                <option key={b.id} value={b.id}>
                  Bill {b.displayNumber}, {formatDate(b.date)}, {rupees(b.totalPaise)}
                </option>
              ))}
          </select>
          <div className="field-note">
            {taxMode === 'interstate'
              ? 'IGST applies (other state).'
              : taxMode === 'exempt'
                ? 'No GST.'
                : 'CGST and SGST apply.'}
          </div>
        </div>
        <div className="field">
          <label htmlFor="note-reason">Reason</label>
          <input
            id="note-reason"
            value={reason}
            autoComplete="off"
            onChange={(e) => {
              setReason(e.target.value);
              touch();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                cells.focus(rows[0]!.key, 'item');
              }
            }}
          />
          <div className="field-note">For example: rate difference agreed on the phone.</div>
        </div>
      </div>

      <div className="voucher-body">
        <section className="voucher-main">
          <table className="data bill-grid">
            <thead>
              <tr>
                <th className="c-no">#</th>
                <th>Item (for its HSN and GST rate)</th>
                <th className="num c-price">Amount before GST</th>
                <th className="num c-disc">GST %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const pv = r.item
                  ? preview?.lines[draftLines.findIndex((l) => l.itemId === r.item?.id)]
                  : null;
                return (
                  <tr key={r.key}>
                    <td className="c-no">{i + 1}</td>
                    <td>
                      <Typeahead<ItemSearchRow>
                        ariaLabel={`Item, row ${i + 1}`}
                        inputRef={(el: HTMLInputElement | null) => cells.set(`${r.key}:item`, el)}
                        text={r.text}
                        onText={(t) => updateRow(r.key, { text: t, item: null })}
                        search={(text) => call('item.search', { text, onDate: date, limit: 12 })}
                        getKey={(it) => it.id}
                        isExact={(it, t) =>
                          it.alias !== null && it.alias.toLowerCase() === t.toLowerCase()
                        }
                        renderOption={(it) => (
                          <>
                            <span>{it.name}</span>
                            <span className="opt-sub">{it.hsn ?? 'no HSN'}</span>
                          </>
                        )}
                        onPick={(it) => {
                          updateRow(r.key, { item: it, text: it.name });
                          cells.focus(r.key, 'value');
                        }}
                        onEnterEmpty={() => document.getElementById('note-save')?.focus()}
                        onNoMatch={(t) => setError(`Row ${i + 1}: no item matches "${t}".`)}
                      />
                    </td>
                    <td className="num">
                      <input
                        aria-label={`Amount, row ${i + 1}`}
                        ref={(el: HTMLInputElement | null) => cells.set(`${r.key}:value`, el)}
                        className="cell-input num"
                        inputMode="decimal"
                        value={r.value}
                        onChange={(e) => updateRow(r.key, { value: e.target.value })}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            nextRow(i);
                          }
                        }}
                      />
                    </td>
                    <td className="num muted-cell">{pv ? formatPercent(pv.rateBp) : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(preview?.problems ?? []).map((p) => (
            <Notice key={p.message} kind={p.kind === 'error' ? 'error' : 'info'}>
              {p.message}
            </Notice>
          ))}
        </section>
        <aside className="voucher-side" aria-label="Note total">
          <Card>
            <dl className="totals">
              <div>
                <dt>Amount before GST</dt>
                <dd>{formatMoney(preview?.taxablePaise ?? 0)}</dd>
              </div>
              {preview?.taxTable.map((t) => (
                <div key={t.rateBp}>
                  <dt>
                    {taxMode === 'interstate' ? 'IGST' : 'CGST + SGST'} {formatPercent(t.rateBp)}
                  </dt>
                  <dd>{formatMoney(t.cgstPaise + t.sgstPaise + t.igstPaise)}</dd>
                </div>
              ))}
              {preview && preview.roundOffPaise !== 0 && (
                <div>
                  <dt>Round off</dt>
                  <dd>{formatMoney(preview.roundOffPaise)}</dd>
                </div>
              )}
              <div className="grand">
                <dt>Total</dt>
                <dd data-testid="bill-total">{formatMoney(preview?.totalPaise ?? 0)}</dd>
              </div>
            </dl>
          </Card>
          <Button id="note-save" variant="primary" disabled={saving} onClick={() => void save()}>
            Save (F2)
          </Button>
        </aside>
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
