import { useState } from 'react';
import type { AccountHit, VoucherDetail } from '@shopledger/core';
import { Button, ConfirmDialog, Notice, PageHeader, useToast } from '../../components/ui.tsx';
import { DateField } from '../../components/DateField.tsx';
import { Typeahead } from '../../components/Typeahead.tsx';
import { call, useCall } from '../../lib/api.ts';
import { formatBalance, formatMoney, parseMoney, rupees } from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter } from '../../lib/router.tsx';
import { useSession } from '../../lib/session.tsx';
import { useCellFocus } from './cells.ts';

interface Line {
  key: number;
  account: AccountHit | null;
  text: string;
  dr: string;
  cr: string;
}

let keySeed = 1;
const blank = (): Line => ({ key: keySeed++, account: null, text: '', dr: '', cr: '' });
const amountOf = (text: string): number => (text.trim() === '' ? 0 : (parseMoney(text) ?? 0));

const INFO = {
  journal: {
    title: 'New Journal Entry',
    explain:
      'Moves an amount from one account to another without cash or bank, for example writing off a bad debt.',
    kind: 'other' as const,
  },
  contra: {
    title: 'New Contra Entry',
    explain:
      'Moves money between Cash and a bank account, for example depositing cash in the bank.',
    kind: 'cash_bank' as const,
  },
};

/** Journal and contra entries: any number of lines, debits must equal credits. */
export function JournalVoucher({
  kind: kindName,
  edit,
}: {
  kind: 'journal' | 'contra';
  edit?: VoucherDetail | undefined;
}) {
  const info = INFO[kindName];
  const router = useRouter();
  const toast = useToast();
  const { today } = useSession();
  const cells = useCellFocus();
  const [date, setDate] = useState(edit?.date ?? today);
  const [lines, setLines] = useState<Line[]>(() =>
    edit
      ? [
          ...edit.entries.map((e) => ({
            key: keySeed++,
            account: {
              id: e.accountId,
              name: e.accountName,
              groupName: '',
              isCashOrBank: false,
              balancePaise: 0,
            },
            text: e.accountName,
            dr: e.side === 'dr' ? formatMoney(e.amountPaise) : '',
            cr: e.side === 'cr' ? formatMoney(e.amountPaise) : '',
          })),
          blank(),
        ]
      : [blank(), blank()],
  );
  const [note, setNote] = useState(edit?.narration ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const setup = useCall('voucher.setup', { type: kindName, date });
  const ready = setup.status === 'ready' ? setup.data : null;

  const totalDr = lines.reduce((t, l) => t + amountOf(l.dr), 0);
  const totalCr = lines.reduce((t, l) => t + amountOf(l.cr), 0);
  const diff = totalDr - totalCr;

  const patch = (key: number, change: Partial<Line>) => {
    setDirty(true);
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...change } : l)));
  };
  const next = (index: number, col: 'dr' | 'cr' | 'account') => {
    const line = lines[index]!;
    if (col === 'account') return cells.focus(line.key, 'dr');
    if (col === 'dr') return cells.focus(line.key, 'cr');
    const after =
      lines[index + 1] ??
      (() => {
        const fresh = blank();
        setLines((ls) => [...ls, fresh]);
        return fresh;
      })();
    cells.focus(after.key, 'account');
  };

  const save = async () => {
    if (saving || !ready) return;
    setError(null);
    const entries: { accountId: number; side: 'dr' | 'cr'; amountPaise: number }[] = [];
    for (const [i, l] of lines.entries()) {
      const dr = amountOf(l.dr);
      const cr = amountOf(l.cr);
      if (!l.account && dr === 0 && cr === 0) continue;
      if (!l.account) return setError(`Line ${i + 1}: please pick the account from the list.`);
      if (dr > 0 && cr > 0)
        return setError(`Line ${i + 1}: use either the Debit or the Credit box, not both.`);
      if (dr === 0 && cr === 0) return setError(`Line ${i + 1}: please enter an amount.`);
      entries.push({
        accountId: l.account.id,
        side: dr > 0 ? 'dr' : 'cr',
        amountPaise: dr > 0 ? dr : cr,
      });
    }
    if (entries.length < 2) return setError('Please enter at least two lines.');
    if (diff !== 0)
      return setError(
        `The debit and credit totals are not equal (difference ${rupees(Math.abs(diff))}).`,
      );
    const input = {
      type: kindName,
      date,
      seriesId: ready.defaultSeriesId,
      ...(note.trim() ? { narration: note.trim() } : {}),
      entries,
    };
    setSaving(true);
    try {
      const posted = edit
        ? await call('voucher.modify', { id: edit.id, input })
        : await call('voucher.post', input);
      toast.show(`Saved. Entry number ${posted.number}.`);
      if (edit) return router.back();
      setLines([blank(), blank()]);
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
  useHints(['F2 Save', 'Esc Cancel', 'Enter Next box', 'F5 Show list']);

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
  const prefix = ready.series.find((s) => s.id === ready.defaultSeriesId)?.prefix ?? '';

  return (
    <main className="page">
      <PageHeader
        title={edit ? `Change entry ${prefix}${edit.number}` : info.title}
        subtitle={info.explain}
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
      <table className="data bill-grid journal-grid">
        <thead>
          <tr>
            <th className="c-no">#</th>
            <th>Account</th>
            <th className="num c-money">Debit</th>
            <th className="num c-money">Credit</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.key}>
              <td className="c-no">{i + 1}</td>
              <td>
                <Typeahead<AccountHit>
                  ariaLabel={`Account, line ${i + 1}`}
                  autoFocus={i === 0}
                  inputRef={(el: HTMLInputElement | null) => cells.set(`${l.key}:account`, el)}
                  text={l.text}
                  onText={(t) =>
                    patch(l.key, {
                      text: t,
                      account: l.account && t === l.account.name ? l.account : null,
                    })
                  }
                  search={(text) => call('account.search', { text, kind: info.kind, asOn: date })}
                  getKey={(a) => a.id}
                  isExact={(a, t) => a.name.toLowerCase() === t.toLowerCase()}
                  renderOption={(a) => (
                    <>
                      <span>
                        {a.name} <span className="opt-sub">· {a.groupName}</span>
                      </span>
                      <span className="opt-sub">{formatBalance(a.balancePaise)}</span>
                    </>
                  )}
                  onPick={(a) => {
                    // offer the amount that makes the entry balance
                    const others = lines.filter((x) => x.key !== l.key);
                    const gap = others.reduce((t, x) => t + amountOf(x.dr) - amountOf(x.cr), 0);
                    patch(l.key, {
                      account: a,
                      text: a.name,
                      ...(l.dr === '' && l.cr === '' && gap !== 0
                        ? gap > 0
                          ? { cr: formatMoney(gap) }
                          : { dr: formatMoney(-gap) }
                        : {}),
                    });
                    next(i, 'account');
                  }}
                  onNoMatch={(t) => setError(`Line ${i + 1}: no account named "${t}".`)}
                  onEnterEmpty={() => cells.focusId('note')}
                />
              </td>
              {(['dr', 'cr'] as const).map((col) => (
                <td key={col} className="num">
                  <input
                    aria-label={`${col === 'dr' ? 'Debit' : 'Credit'}, line ${i + 1}`}
                    className="cell-input num"
                    inputMode="decimal"
                    ref={(el: HTMLInputElement | null) => cells.set(`${l.key}:${col}`, el)}
                    value={l[col]}
                    onChange={(e) =>
                      patch(
                        l.key,
                        col === 'dr'
                          ? { dr: e.target.value, cr: '' }
                          : { cr: e.target.value, dr: '' },
                      )
                    }
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        next(i, col);
                      }
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th />
            <th>Total</th>
            <th className="num" data-testid="total-dr">
              {formatMoney(totalDr)}
            </th>
            <th className="num" data-testid="total-cr">
              {formatMoney(totalCr)}
            </th>
          </tr>
        </tfoot>
      </table>
      <p className={diff === 0 ? 'muted' : 'diff-note'}>
        {diff === 0
          ? 'Debit and credit are equal.'
          : `Difference: ${rupees(Math.abs(diff))} (${diff > 0 ? 'more debit' : 'more credit'})`}
      </p>
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
