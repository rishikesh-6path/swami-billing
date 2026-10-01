import { PageHeader, Button } from '../../components/ui.tsx';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter, type ReportKind } from '../../lib/router.tsx';
import { useSession } from '../../lib/session.tsx';
import { REPORT_INFO } from './ReportScreen.tsx';

const GROUPS: { title: string; kinds: ReportKind[]; ownerOnly?: boolean }[] = [
  { title: 'Every day', kinds: ['daySummary', 'dayBook', 'stock', 'outstanding'] },
  {
    title: 'Customers, suppliers and items',
    kinds: ['ledger', 'itemLedger', 'salesRegister', 'purchaseRegister'],
  },
  {
    title: 'Accounts (owner)',
    kinds: ['profitAndLoss', 'balanceSheet', 'trialBalance'],
    ownerOnly: true,
  },
  { title: 'GST (owner)', kinds: ['gstSummary', 'gstr1', 'gstr3b'], ownerOnly: true },
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
    </main>
  );
}
