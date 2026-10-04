import { useState } from 'react';
import type { AccountHit, ItemSearchRow } from '@shopledger/core';
import type { ReportRequest } from '../../../ipc/contract.ts';
import { DateField } from '../../components/DateField.tsx';
import { Typeahead } from '../../components/Typeahead.tsx';
import { Button, LoadState, Notice, PageHeader, useToast } from '../../components/ui.tsx';
import { call, useCall } from '../../lib/api.ts';
import { formatBalance } from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { PRESET_LABELS, presetRange, type Preset } from '../../lib/periods.ts';
import { useRouter, type ReportKind } from '../../lib/router.tsx';
import { useSession } from '../../lib/session.tsx';
import { ReportBody } from './ReportBody.tsx';

export const REPORT_INFO: Record<
  ReportKind,
  { title: string; about: string; shape: 'period' | 'asOn' | 'day'; subject?: 'account' | 'item' }
> = {
  ledger: {
    title: 'Account Ledger',
    about: 'Every entry of one customer, supplier or account, with the running balance.',
    shape: 'period',
    subject: 'account',
  },
  stock: {
    title: 'Stock Report',
    about: 'How much of each item you have, and what it is worth.',
    shape: 'asOn',
  },
  itemLedger: {
    title: 'Item History',
    about: 'Every purchase and sale of one item.',
    shape: 'period',
    subject: 'item',
  },
  trialBalance: {
    title: 'Trial Balance',
    about: 'Every account with its debit and credit totals. Both sides must match.',
    shape: 'period',
  },
  dayBook: {
    title: 'Day Book',
    about: 'Every bill and entry, in the order made.',
    shape: 'period',
  },
  daySummary: {
    title: 'Day Summary',
    about: 'One day at a glance: cash in and out and the number of bills.',
    shape: 'day',
  },
  outstanding: {
    title: 'Outstanding',
    about: 'Who owes you, or whom you owe, with how old the dues are.',
    shape: 'asOn',
  },
  salesRegister: {
    title: 'Sales Register',
    about: 'All sales bills with GST, returns taken off.',
    shape: 'period',
  },
  purchaseRegister: {
    title: 'Purchase Register',
    about: 'All purchase bills with GST, returns taken off.',
    shape: 'period',
  },
  gstSummary: {
    title: 'GST Summary',
    about: 'GST collected on sales against GST paid on purchases.',
    shape: 'period',
  },
  gstr1: {
    title: 'GSTR-1 Sales Return',
    about: 'The tables for your monthly or quarterly sales return. Export them for your CA.',
    shape: 'period',
  },
  gstr3b: {
    title: 'GSTR-3B Summary',
    about: 'The figures for your summary return.',
    shape: 'period',
  },
  purchasesForCa: {
    title: 'Purchases for the CA',
    about:
      "Every purchase with the supplier's own invoice number, date and GST, ready to match against their filings.",
    shape: 'period',
  },
  reorder: {
    title: 'Items to Order',
    about: 'Items that are running below their minimum, with who you last bought them from.',
    shape: 'asOn',
  },
  profitAndLoss: {
    title: 'Profit and Loss',
    about: 'What you earned and spent, and the profit.',
    shape: 'period',
  },
  balanceSheet: {
    title: 'Balance Sheet',
    about: 'What you own and what you owe on a date.',
    shape: 'asOn',
  },
};

/** One report with its date choices, a table, and Export and Print buttons. */
export function ReportScreen({
  kind,
  accountId,
  accountName,
  side,
}: {
  kind: ReportKind;
  accountId?: number | undefined;
  accountName?: string | undefined;
  side?: 'receivable' | 'payable' | undefined;
}) {
  const info = REPORT_INFO[kind];
  const router = useRouter();
  const toast = useToast();
  const { today, financialYear } = useSession();
  const defaultPreset: Preset =
    kind === 'gstSummary' || kind === 'gstr1' || kind === 'gstr3b' || kind === 'purchasesForCa'
      ? 'thisMonth'
      : kind === 'profitAndLoss' || kind === 'trialBalance'
        ? 'thisYear'
        : 'thisMonth';
  const [preset, setPreset] = useState<Preset>(defaultPreset);
  const [custom, setCustom] = useState({ from: today, to: today });
  const [asOn, setAsOn] = useState(today);
  const [outSide, setOutSide] = useState<'receivable' | 'payable'>(side ?? 'receivable');
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [countSheet, setCountSheet] = useState(false);
  const [subject, setSubject] = useState<{ id: number; name: string } | null>(
    accountId ? { id: accountId, name: accountName ?? '' } : null,
  );
  const [subjectText, setSubjectText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = preset === 'custom' ? custom : presetRange(preset, today, financialYear);

  let request: ReportRequest | null = null;
  switch (kind) {
    case 'ledger':
      request = subject ? { kind, accountId: subject.id, ...range } : null;
      break;
    case 'itemLedger':
      request = subject ? { kind, itemId: subject.id, ...range } : null;
      break;
    case 'stock':
      request = {
        kind,
        asOn,
        ...(onlyProblems ? { onlyProblems: true } : {}),
        ...(countSheet ? { countSheet: true } : {}),
      };
      break;
    case 'outstanding':
      request = { kind, asOn, side: outSide };
      break;
    case 'balanceSheet':
    case 'reorder':
      request = { kind, asOn };
      break;
    case 'daySummary':
      request = { kind, date: asOn };
      break;
    default:
      request = { kind, ...range };
  }

  const exportIt = () => {
    if (!request) return;
    setError(null);
    call('report.export', request).then(
      ({ saved }) => {
        if (saved) toast.show(`Saved to ${saved}`);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'The file could not be saved.'),
    );
  };

  const savePdf = () => {
    if (!request) return;
    setError(null);
    call('report.pdf', request).then(
      ({ saved }) => {
        if (saved) toast.show(`Saved to ${saved}`);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'The PDF could not be saved.'),
    );
  };

  useHotkeys({
    Escape: router.back,
    'Ctrl+P': () => window.print(),
    'Ctrl+E': exportIt,
    'Ctrl+S': savePdf,
  });
  useHints(['Esc Back', 'Ctrl+E Save as spreadsheet', 'Ctrl+S Save as PDF', 'Ctrl+P Print']);

  return (
    <main className="page report-page">
      <PageHeader
        title={info.title}
        subtitle={info.about}
        actions={
          <>
            <Button onClick={router.back}>Back (Esc)</Button>
            {kind !== 'daySummary' && (
              <Button onClick={exportIt} disabled={!request}>
                Save as spreadsheet
              </Button>
            )}
            <Button onClick={savePdf} disabled={!request}>
              Save as PDF
            </Button>
            <Button onClick={() => window.print()}>Print</Button>
          </>
        }
      />
      {error && <Notice>{error}</Notice>}
      <div className="report-controls">
        {info.subject === 'account' && (
          <div className="field">
            <label>Account</label>
            <Typeahead<AccountHit>
              ariaLabel="Account"
              autoFocus={!subject}
              text={subjectText ?? subject?.name ?? ''}
              onText={(t) => {
                setSubjectText(t);
                setSubject(null);
              }}
              search={(text) => call('account.search', { text, kind: 'any', asOn: range.to })}
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
                setSubject({ id: a.id, name: a.name });
                setSubjectText(null);
              }}
              onNoMatch={(t) => setError(`No account named "${t}".`)}
            />
            <div className="field-note" />
          </div>
        )}
        {info.subject === 'item' && (
          <div className="field">
            <label>Item</label>
            <Typeahead<ItemSearchRow>
              ariaLabel="Item"
              autoFocus={!subject}
              text={subjectText ?? subject?.name ?? ''}
              onText={(t) => {
                setSubjectText(t);
                setSubject(null);
              }}
              search={(text) => call('item.search', { text, onDate: range.to, limit: 12 })}
              getKey={(i) => i.id}
              isExact={(i, t) => i.alias?.toLowerCase() === t.toLowerCase()}
              renderOption={(i) => (
                <>
                  <span>
                    {i.name} <span className="opt-sub">· {i.alias}</span>
                  </span>
                </>
              )}
              onPick={(i) => {
                setSubject({ id: i.id, name: i.name });
                setSubjectText(null);
              }}
              onNoMatch={(t) => setError(`No item matches "${t}".`)}
            />
            <div className="field-note" />
          </div>
        )}
        {info.shape === 'period' && (
          <>
            <div className="field">
              <label htmlFor="preset">Period</label>
              <select
                id="preset"
                value={preset}
                onChange={(e) => setPreset(e.target.value as Preset)}
              >
                {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
                  <option key={p} value={p}>
                    {PRESET_LABELS[p]}
                  </option>
                ))}
              </select>
              <div className="field-note" />
            </div>
            {preset === 'custom' && (
              <>
                <DateField
                  label="From"
                  value={custom.from}
                  today={today}
                  onChange={(v) => setCustom((c) => ({ ...c, from: v }))}
                />
                <DateField
                  label="To"
                  value={custom.to}
                  today={today}
                  onChange={(v) => setCustom((c) => ({ ...c, to: v }))}
                />
              </>
            )}
          </>
        )}
        {info.shape !== 'period' && (
          <DateField
            label={info.shape === 'day' ? 'Day' : 'As on'}
            value={asOn}
            today={today}
            onChange={setAsOn}
          />
        )}
        {kind === 'outstanding' && (
          <div className="field">
            <label htmlFor="side">Show</label>
            <select
              id="side"
              value={outSide}
              onChange={(e) => setOutSide(e.target.value === 'payable' ? 'payable' : 'receivable')}
            >
              <option value="receivable">Who owes me (customers)</option>
              <option value="payable">Whom I owe (suppliers)</option>
            </select>
            <div className="field-note" />
          </div>
        )}
        {kind === 'stock' && (
          <label className="check">
            <input
              type="checkbox"
              checked={onlyProblems}
              onChange={(e) => setOnlyProblems(e.target.checked)}
            />{' '}
            Only items running low or below zero
          </label>
        )}
        {kind === 'stock' && (
          <label className="check">
            <input
              type="checkbox"
              checked={countSheet}
              onChange={(e) => setCountSheet(e.target.checked)}
            />{' '}
            Counting sheet (an empty box to write the counted quantity in)
          </label>
        )}
      </div>
      {info.shape === 'period' && preset !== 'custom' && (
        <p className="muted">
          Showing {range.from.split('-').reverse().join('-')} to{' '}
          {range.to.split('-').reverse().join('-')}
        </p>
      )}
      {request ? (
        <Result request={request} />
      ) : (
        <p className="muted">
          {info.subject === 'item'
            ? 'Please choose an item above.'
            : 'Please choose an account above.'}
        </p>
      )}
    </main>
  );
}

function Result({ request }: { request: ReportRequest }) {
  const result = useCall('report.run', request);
  return (
    <LoadState state={result}>
      {result.status === 'ready' && <ReportBody result={result.data} />}
    </LoadState>
  );
}
