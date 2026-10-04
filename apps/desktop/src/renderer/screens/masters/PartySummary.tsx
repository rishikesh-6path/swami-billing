import { DataTable } from '../../components/DataTable.tsx';
import { Button, Card, LoadState, PageHeader } from '../../components/ui.tsx';
import { useCall } from '../../lib/api.ts';
import { formatDate, rupees, VOUCHER_LABELS } from '../../lib/format.ts';
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
  const label =
    owed < 0
      ? customer
        ? 'They paid in advance'
        : 'You paid in advance'
      : customer
        ? 'Owes you'
        : 'You owe';

  const edit = () => router.go({ name: 'party', kind, id });
  // a new bill or entry that already knows who it is for
  const start = data ? { id, name: data.name, stateCode: data.stateCode } : undefined;
  const newBill = (billKind: 'sales' | 'purchase') => () =>
    router.go({ name: 'voucher', kind: billKind, ...(start ? { party: start } : {}) });
  const newEntry = (entryKind: 'receipt' | 'payment') => () =>
    router.go({ name: 'entry', kind: entryKind, ...(start ? { party: start } : {}) });
  const ledger = () =>
    data && router.go({ name: 'report', kind: 'ledger', accountId: id, accountName: data.name });
  useHotkeys({
    F2: edit,
    L: ledger,
    // a customer is sold to and pays in; a supplier is bought from and paid
    ...(customer
      ? { F8: newBill('sales'), F6: newEntry('receipt') }
      : { F9: newBill('purchase'), F5: newEntry('payment') }),
  });
  useHints(
    customer
      ? ['L Statement and full ledger', 'F2 Change details', 'F8 Sale', 'F6 Receipt', 'Esc Back']
      : [
          'L Statement and full ledger',
          'F2 Change details',
          'F9 Purchase',
          'F5 Payment',
          'Esc Back',
        ],
  );

  return (
    <main className="page">
      <PageHeader
        title={data?.name ?? (customer ? 'Customer' : 'Supplier')}
        subtitle={customer ? 'Customer' : 'Supplier'}
        actions={
          <>
            <Button onClick={router.back}>Back (Esc)</Button>
            <Button onClick={ledger} disabled={!data}>
              Statement and full ledger (L)
            </Button>
            {customer ? (
              <>
                <Button onClick={newBill('sales')} disabled={!data}>
                  New sale (F8)
                </Button>
                <Button onClick={newEntry('receipt')} disabled={!data}>
                  Receipt (F6)
                </Button>
              </>
            ) : (
              <>
                <Button onClick={newBill('purchase')} disabled={!data}>
                  New purchase (F9)
                </Button>
                <Button onClick={newEntry('payment')} disabled={!data}>
                  Payment (F5)
                </Button>
              </>
            )}
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
              </Card>
              <Card className="stat">
                <span className="stat-label">
                  {data.creditDays === 0
                    ? 'Late (no credit days given)'
                    : `Late (past ${data.creditDays} credit days)`}
                </span>
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
                {data.creditLimitPaise > 0 && (
                  <span className="muted">Credit limit {rupees(data.creditLimitPaise)}</span>
                )}
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
