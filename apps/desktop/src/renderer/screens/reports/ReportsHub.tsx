import { useState } from 'react';
import { PageHeader, Button, Card, Notice, useToast } from '../../components/ui.tsx';
import { call } from '../../lib/api.ts';
import { PRESET_LABELS, presetRange, type Preset } from '../../lib/periods.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter, type ReportKind } from '../../lib/router.tsx';
import { useSession } from '../../lib/session.tsx';
import { REPORT_INFO } from './ReportScreen.tsx';

const GROUPS: { title: string; kinds: ReportKind[]; ownerOnly?: boolean }[] = [
  { title: 'Every day', kinds: ['daySummary', 'dayBook', 'stock', 'reorder', 'outstanding'] },
  {
    title: 'Customers, suppliers and items',
    kinds: ['ledger', 'itemLedger', 'salesRegister', 'purchaseRegister'],
  },
  {
    title: 'Accounts (owner)',
    kinds: ['profitAndLoss', 'itemSales', 'balanceSheet', 'trialBalance'],
    ownerOnly: true,
  },
  {
    title: 'GST (owner)',
    kinds: ['gstSummary', 'gstr1', 'gstr3b', 'purchasesForCa'],
    ownerOnly: true,
  },
];

export function ReportsHub() {
  const router = useRouter();
  const { user } = useSession();
  const owner = user?.role === 'owner';
  useHotkeys({ Escape: router.back });
  useHints(['Esc Back']);
  return (
    <main className="page">
      <PageHeader
        title="Reports"
        subtitle="Choose a report. You can save any of them as a spreadsheet or print it."
        actions={<Button onClick={router.back}>Back (Esc)</Button>}
      />
      {GROUPS.filter((g) => owner || !g.ownerOnly).map((g) => (
        <section key={g.title}>
          <h2>{g.title}</h2>
          <div className="tiles">
            {g.kinds.map((kind) => (
              <button
                key={kind}
                type="button"
                className="tile"
                onClick={() => router.go({ name: 'report', kind })}
              >
                <span className="tile-title">{REPORT_INFO[kind].title}</span>
                <span className="tile-key">{REPORT_INFO[kind].about}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {owner && <AccountantExport />}
    </main>
  );
}

const EXPORT_PRESETS: Exclude<Preset, 'custom' | 'today'>[] = [
  'thisMonth',
  'lastMonth',
  'thisQuarter',
  'thisYear',
];

/** Saves every bill, ledger line, item and party for a period in one folder for the accountant. */
function AccountantExport() {
  const toast = useToast();
  const { today, financialYear } = useSession();
  const [preset, setPreset] = useState<(typeof EXPORT_PRESETS)[number]>('thisYear');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const range = presetRange(preset, today, financialYear);
  const save = () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    call('books.export', range).then(
      ({ saved }) => {
        setBusy(false);
        if (saved) toast.show(`Saved in ${saved}. Give this folder to your accountant.`);
      },
      (e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : 'The files could not be saved.');
      },
    );
  };
  return (
    <section>
      <h2>Data for the accountant (owner)</h2>
      <Card>
        <p className="muted">
          Saves every bill and entry, the debit and credit lines behind them, and your item,
          customer and supplier lists, as spreadsheets in one folder you choose.
        </p>
        {error && <Notice>{error}</Notice>}
        <div className="field">
          <label htmlFor="export-period">Period</label>
          <select
            id="export-period"
            value={preset}
            onChange={(e) => setPreset(e.target.value as (typeof EXPORT_PRESETS)[number])}
          >
            {EXPORT_PRESETS.map((p) => (
              <option key={p} value={p}>
                {PRESET_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <Button variant="primary" disabled={busy} onClick={save}>
          Save everything for my accountant
        </Button>
      </Card>
    </section>
  );
}
