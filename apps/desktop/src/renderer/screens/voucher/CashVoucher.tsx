import { useEffect, useRef, useState } from 'react';
import type { PartyHit, VoucherDetail } from '@shopledger/core';
import { Button, ConfirmDialog, Notice, PageHeader, useToast } from '../../components/ui.tsx';
import { DateField } from '../../components/DateField.tsx';
import { Typeahead } from '../../components/Typeahead.tsx';
import { call, useCall, useKept } from '../../lib/api.ts';
import { formatBalance, formatMoney, parseMoney, rupees } from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter, type StartParty } from '../../lib/router.tsx';
import { useSession } from '../../lib/session.tsx';
import { useCellFocus } from './cells.ts';

const KINDS = {
  receipt: {
    title: 'New Receipt',
    partyLabel: 'Received from',
    accountLabel: 'Received in',
    amountLabel: 'Amount received',
    notes: ['Payment received', 'Part payment received', 'Advance received'],
  },
  payment: {
    title: 'New Payment',
    partyLabel: 'Paid to',
    accountLabel: 'Paid from',
    amountLabel: 'Amount paid',
    notes: ['Payment made', 'Part payment made', 'Advance paid'],
  },
} as const;

/** Money received from, or paid to, a customer or supplier (or any account). */
export function CashVoucher({
  kind: kindName,
  edit,
  startParty,
}: {
  kind: 'receipt' | 'payment';
  edit?: VoucherDetail | undefined;
  /** Who the entry starts with, when opened from a customer or supplier page. */
  startParty?: StartParty | undefined;
}) {
  const kind = KINDS[kindName];
  const router = useRouter();
  const toast = useToast();
  const { today } = useSession();
  const cells = useCellFocus();

  const partyEntry = edit?.entries.find((e) => e.side === (kindName === 'receipt' ? 'cr' : 'dr'));
  const moneyEntry = edit?.entries.find((e) => e.side === (kindName === 'receipt' ? 'dr' : 'cr'));
  const [date, setDate] = useState(edit?.date ?? today);
  const [party, setParty] = useState<
    (Pick<PartyHit, 'id' | 'name'> & { balancePaise?: number }) | null
  >(
    partyEntry
      ? { id: partyEntry.accountId, name: partyEntry.accountName }
      : startParty
        ? { id: startParty.id, name: startParty.name }
        : null,
  );
  const [partyText, setPartyText] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<number | null>(moneyEntry?.accountId ?? null);
  const [amount, setAmount] = useState(edit ? formatMoney(edit.totalPaise) : '');
  const [note, setNote] = useState(edit?.narration ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const setup = useCall('voucher.setup', { type: kindName, date });
  const ready = useKept(setup);
  // opened from a customer page: the party is known, so go straight to the amount
  const startedOnAmount = useRef(false);
  useEffect(() => {
    if (startParty && ready && !startedOnAmount.current) {
      startedOnAmount.current = true;
      cells.focusId('amount');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const save = async () => {
    if (saving || !ready) return;
    setError(null);
    if (!party)
      return setError(
        `Please choose who the money is ${kindName === 'receipt' ? 'from' : 'paid to'}.`,
      );
    const paise = parseMoney(amount);
    if (paise === null || paise <= 0) return setError('Please enter the amount.');
    const money = accountId ?? ready.cashAccountId;
    const entries =
      kindName === 'receipt'
        ? [
            { accountId: money, side: 'dr' as const, amountPaise: paise },
            { accountId: party.id, side: 'cr' as const, amountPaise: paise },
          ]
        : [
            { accountId: party.id, side: 'dr' as const, amountPaise: paise },
            { accountId: money, side: 'cr' as const, amountPaise: paise },
          ];
    const input = {
      type: kindName,
      date,
      seriesId: ready.defaultSeriesId,
      partyAccountId: party.id,
      ...(note.trim() ? { narration: note.trim() } : {}),
      entries,
    };
    setSaving(true);
    try {
      const posted = edit
        ? await call('voucher.modify', { id: edit.id, input })
        : await call('voucher.post', input);
      toast.show(
        `Saved. ${kindName === 'receipt' ? 'Receipt' : 'Payment'} number ${posted.number}, ${rupees(posted.totalPaise)}.`,
      );
      if (edit) return router.back();
      setParty(null);
      setPartyText(null);
      setAmount('');
      setNote('');
      setDirty(false);
      setup.reload();
      cells.focusId('party');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong and nothing was saved.');
    } finally {
      setSaving(false);
    }
  };

  const leave = () => (dirty ? setConfirmExit(true) : router.back());
  useHotkeys({ F2: () => void save(), Escape: leave });
  useHints(['F2 Save', 'Esc Cancel', 'Enter Next box', 'F5 Show list']);

  if (!ready) {
    return (
      <main className="page">
        {setup.status === 'error' ? (
          <Notice>{setup.message}</Notice>
        ) : (
          <p className="muted">Getting things ready...</p>
        )}
      </main>
    );
  }
  const prefix = ready.series.find((s) => s.id === ready.defaultSeriesId)?.prefix ?? '';

  return (
    <main className="page">
      <PageHeader
        title={
          edit
            ? `Change ${kindName === 'receipt' ? 'Receipt' : 'Payment'} ${prefix}${edit.number}`
            : kind.title
        }
        subtitle={
          edit
            ? 'Saving will replace this entry with a corrected one.'
            : `Number ${prefix}${ready.nextNumber}`
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
      <div className="form-grid cash-form">
        <div className="field">
          <label>{kind.partyLabel}</label>
          <Typeahead<PartyHit>
            ariaLabel={kind.partyLabel}
            autoFocus={!startParty}
            inputRef={(el: HTMLInputElement | null) => cells.set('party', el)}
            text={partyText ?? party?.name ?? ''}
            onText={(t) => {
              setPartyText(t);
              setParty(null);
              setDirty(true);
            }}
            search={(text) => call('party.search', { text, kind: 'any', asOn: date })}
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
              setDirty(true);
              cells.focusId('amount');
            }}
            onNoMatch={(t) =>
              setError(
                `No customer or supplier named "${t}". Add them first from the Customers screen.`,
              )
            }
          />
          <div className="field-note">
            {party?.balancePaise !== undefined && party.balancePaise !== 0
              ? party.balancePaise > 0
                ? `Owes you ${rupees(party.balancePaise)}`
                : `You owe ${rupees(-party.balancePaise)}`
              : ''}
          </div>
        </div>
        <DateField label="Date" value={date} today={today} onChange={setDate} />
        <div className="field">
          <label htmlFor="money-account">{kind.accountLabel}</label>
          <select
            id="money-account"
            value={accountId ?? ready.cashAccountId}
            onChange={(e) => setAccountId(Number(e.target.value))}
          >
            {ready.paymentAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <div className="field-note" />
        </div>
        <div className="field">
          <label htmlFor="amount">{kind.amountLabel}</label>
          <input
            id="amount"
            inputMode="decimal"
            ref={(el: HTMLInputElement | null) => cells.set('amount', el)}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setDirty(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('note')?.focus();
              }
            }}
          />
          <div className="field-note" />
        </div>
        <div className="field wide">
          <label htmlFor="note">Note (optional)</label>
          <input
            id="note"
            list="notes"
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
          <datalist id="notes">
            {kind.notes.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <div className="field-note">Press Enter here to save.</div>
        </div>
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
