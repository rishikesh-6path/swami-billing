import { DataTable } from '../../components/DataTable.tsx';
import { Button, Card, LoadState, PageHeader } from '../../components/ui.tsx';
import { useCall } from '../../lib/api.ts';
import { formatBalance, formatDate, rupees, VOUCHER_LABELS } from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter, type PartyKind } from '../../lib/router.tsx';
import { useSession } from '../../lib/session.tsx';

/** One customer or supplier on a page: what they owe, what is late, and the latest bills and payments. */
export function PartySummaryScreen({ id, kind }: { id: number; kind: PartyKind }) {
  const router = useRouter();
  const { today } = useSession();
  const summary = useCall('party.summary', { id, asOn: today });
  const data = summary.status === 'ready' ? summary.data : null;
  const customer = (data?.kind ?? kind) === 'customer';
  // positive: money still to come in (customer) or to go out (supplier); negative: paid in advance
  const owed = data ? (customer ? data.balancePaise : -data.balancePaise) : 0;
  const label = owed < 0 ? 'Paid in advance' : customer ? 'Owes you' : 'You owe';

  const edit = () => router.go({ name: 'party', kind, id });
  const ledger = () =>
    data && router.go({ name: 'report', kind: 'ledger', accountId: id, accountName: data.name });
  useHotkeys({
    F2: edit,
    L: ledger,
    F8: () => router.go({ name: 'voucher', kind: 'sales' }),
    F9: () => router.go({ name: 'voucher', kind: 'purchase' }),
    F6: () => router.go({ name: 'entry', kind: 'receipt' }),
    F5: () => router.go({ name: 'entry', kind: 'payment' }),
  });
  useHints(['L Full ledger', 'F2 Change details', 'F8 Sale', 'F6 Receipt', 'Esc Back']);

  return (
    <main className="page">
      <PageHeader
        title={data?.name ?? (customer ? 'Customer' : 'Supplier')}
        subtitle={customer ? 'Customer' : 'Supplier'}
        actions={
          <>
            <Button onClick={router.back}>Back (Esc)</Button>
            <Button onClick={ledger} disabled={!data}>
              Full ledger (L)
            </Button>
            <Button variant="primary" onClick={edit}>
              Change details (F2)
            </Button>
          </>
        }
      />
      <LoadState state={summary}>
        {data && (
          <>
            <div className="stat-row">
              <Card className="stat">
                <span className="stat-label">{label}</span>
                <span className="stat-value" data-testid="party-balance">
                  {rupees(Math.abs(owed))}
                </span>
                <span className="muted">{formatBalance(data.balancePaise)}</span>
              </Card>
              <Card className="stat">
                <span className="stat-label">Late (past {data.creditDays} credit days)</span>
                <span className="stat-value" data-testid="party-overdue">
                  {rupees(data.overduePaise)}
                </span>
                <span className="muted">
                  {data.oldestOverdue
                    ? `Oldest: ${data.oldestOverdue.label}, ${data.oldestOverdue.ageDays} days old`
                    : 'Nothing is late'}
                </span>
              </Card>
              <Card className="stat">
                <span className="stat-label">Contact</span>
                <span>{data.phone ?? 'No phone number'}</span>
                <span className="muted">{data.gstin ? `GST ${data.gstin}` : 'No GST number'}</span>
                <span className="muted">{data.address ?? ''}</span>
              </Card>
            </div>
            <Card title="Latest bills">
              <DataTable
                rows={data.recentBills}
                rowKey={(b) => b.id}
                empty="No bills yet."
                columns={[
                  { header: 'Date', cell: (b) => formatDate(b.date) },
                  { header: 'Kind', cell: (b) => VOUCHER_LABELS[b.voucherType] ?? b.voucherType },
                  {
                    header: 'No.',
                    cell: (b) => (
                      <Button onClick={() => router.go({ name: 'bill', id: b.id })}>
                        {b.displayNumber}
                      </Button>
                    ),
                  },
                  { header: 'Amount', cell: (b) => rupees(b.amountPaise), num: true },
                ]}
              />
            </Card>
            <Card title={customer ? 'Latest payments received' : 'Latest payments made'}>
              <DataTable
                rows={data.recentPayments}
                rowKey={(b) => b.id}
                empty="No payments yet."
                columns={[
                  { header: 'Date', cell: (b) => formatDate(b.date) },
                  {
                    header: 'No.',
                    cell: (b) => (
                      <Button onClick={() => router.go({ name: 'bill', id: b.id })}>
                        {b.displayNumber}
                      </Button>
                    ),
                  },
                  { header: 'Amount', cell: (b) => rupees(b.amountPaise), num: true },
                ]}
              />
            </Card>
          </>
        )}
      </LoadState>
    </main>
  );
}
