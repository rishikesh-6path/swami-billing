import { useEffect, useRef, useState } from 'react';
import { DateField } from '../../components/DateField.tsx';
import { DataTable } from '../../components/DataTable.tsx';
import { Button, LoadState, PageHeader } from '../../components/ui.tsx';
import { useCall } from '../../lib/api.ts';
import { formatDate, formatMoney, VOUCHER_LABELS } from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { PRESET_LABELS, presetRange, type Preset } from '../../lib/periods.ts';
import { useRouter } from '../../lib/router.tsx';
import { useSession } from '../../lib/session.tsx';

/** Find any bill or entry by date, kind or words, then open it. */
export function BillList({ voucherType }: { voucherType?: string | undefined }) {
  const router = useRouter();
  const { today, financialYear } = useSession();
  const [type, setType] = useState(voucherType ?? '');
  const [preset, setPreset] = useState<Preset>('thisMonth');
  const [custom, setCustom] = useState({ from: today, to: today });
  const [text, setText] = useState('');
  const [withCancelled, setWithCancelled] = useState(false);
  const [selected, setSelected] = useState(0);
  const range = preset === 'custom' ? custom : presetRange(preset, today, financialYear);
  const found = useCall('voucher.list', {
    ...(type ? { voucherType: type } : {}),
    from: range.from,
    to: range.to,
    ...(text.trim() ? { search: text.trim() } : {}),
    includeCancelled: withCancelled,
  });
  const rows = found.status === 'ready' ? found.data : [];
  // Enter pressed while the list is still being looked up opens the bill once it is there
  const openWhenReady = useRef(false);
  const open = (id: number) => router.go({ name: 'bill', id });
  useEffect(() => {
    if (found.status === 'loading' || !openWhenReady.current) return;
    openWhenReady.current = false;
    const row = found.status === 'ready' ? found.data[selected] : undefined;
    if (row) router.go({ name: 'bill', id: row.id });
  }, [found, selected, router]);
  useHotkeys({ Escape: router.back });
  useHints(['Type to search', 'Up/Down Choose', 'Enter Open', 'Esc Back']);

  return (
    <main className="page">
      <PageHeader
        title="Find a Bill"
        subtitle="Look up any bill or entry, then open it to view, change or cancel it."
        actions={<Button onClick={router.back}>Back (Esc)</Button>}
      />
      <div className="report-controls">
        <div className="field">
          <label htmlFor="bill-search">Words to look for</label>
          <input
            id="bill-search"
            autoFocus
            autoComplete="off"
            placeholder="Customer name, bill number or note"
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
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (found.status === 'loading') openWhenReady.current = true;
                else if (rows[selected]) open(rows[selected].id);
              }
            }}
          />
          <div className="field-note" />
        </div>
        <div className="field">
          <label htmlFor="bill-type">Kind</label>
          <select
            id="bill-type"
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setSelected(0);
            }}
          >
            <option value="">All</option>
            {Object.entries(VOUCHER_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <div className="field-note" />
        </div>
        <div className="field">
          <label htmlFor="bill-period">Period</label>
          <select
            id="bill-period"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value as Preset);
              setSelected(0);
            }}
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
        <label className="check">
          <input
            type="checkbox"
            checked={withCancelled}
            onChange={(e) => setWithCancelled(e.target.checked)}
          />{' '}
          Also show cancelled bills
        </label>
      </div>
      <LoadState state={found}>
        <DataTable
          rowKey={(r) => r.id}
          rows={rows}
          empty="No bills found. Try a wider period or different words."
          rowClass={(r) =>
            `clickable ${r.status === 'cancelled' ? 'row-muted' : ''} ${rows[selected]?.id === r.id ? 'row-selected' : ''}`
          }
          columns={[
            { header: 'Date', cell: (r) => <RowLink id={r.id}>{formatDate(r.date)}</RowLink> },
            { header: 'Kind', cell: (r) => VOUCHER_LABELS[r.voucherType] ?? r.voucherType },
            { header: 'No.', cell: (r) => r.displayNumber },
            { header: 'Party', cell: (r) => r.partyName },
            { header: 'Note', cell: (r) => r.narration },
            {
              header: 'Amount',
              num: true,
              cell: (r) => (r.totalPaise ? formatMoney(r.totalPaise) : ''),
            },
            { header: '', cell: (r) => (r.status === 'cancelled' ? 'Cancelled' : '') },
          ]}
        />
      </LoadState>
    </main>
  );
}

function RowLink({ id, children }: { id: number; children: string }) {
  const router = useRouter();
  return (
    <button type="button" className="link-button" onClick={() => router.go({ name: 'bill', id })}>
      {children}
    </button>
  );
}
