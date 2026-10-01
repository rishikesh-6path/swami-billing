import { useState } from 'react';
import type { VoucherDetail } from '@shopledger/core';
import { DataTable } from '../../components/DataTable.tsx';
import { Button, Card, LoadState, Notice, PageHeader, useToast } from '../../components/ui.tsx';
import { call, useCall } from '../../lib/api.ts';
import {
  formatDate,
  formatMoney,
  formatPercent,
  formatQty,
  rupees,
  VOUCHER_LABELS,
} from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter, type EntryKind, type ItemVoucherKind } from '../../lib/router.tsx';

const ITEM_KINDS = ['sales', 'purchase', 'sales_return', 'purchase_return'];
const ENTRY_KINDS = ['receipt', 'payment', 'journal', 'contra'];

export function BillView({ id }: { id: number }) {
  const router = useRouter();
  const detail = useCall('voucher.get', { id });
  return (
    <LoadState state={detail}>
      {detail.status === 'ready' && detail.data ? (
        <View bill={detail.data} onChanged={detail.reload} />
      ) : (
        <main className="page">
          <p>That bill could not be found.</p>
          <Button onClick={router.back}>Go back</Button>
        </main>
      )}
    </LoadState>
  );
}

function View({ bill, onChanged }: { bill: VoucherDetail; onChanged: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const label = VOUCHER_LABELS[bill.voucherType] ?? bill.voucherType;
  const cancelled = bill.status === 'cancelled';
  const changeable =
    !cancelled && (ITEM_KINDS.includes(bill.voucherType) || ENTRY_KINDS.includes(bill.voucherType));

  const change = () => {
    if (!changeable) return;
    if (ITEM_KINDS.includes(bill.voucherType))
      router.go({ name: 'voucher', kind: bill.voucherType as ItemVoucherKind, editId: bill.id });
    else router.go({ name: 'entry', kind: bill.voucherType as EntryKind, editId: bill.id });
  };
  const cancel = () => {
    if (reason.trim().length < 3)
      return setError('Please write a short reason, for example "Wrong customer".');
    call('voucher.cancel', { id: bill.id, reason: reason.trim() }).then(
      () => {
        toast.show(`${label} ${bill.displayNumber} has been cancelled.`);
        setAsking(false);
        setReason('');
        onChanged();
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'The bill could not be cancelled.'),
    );
  };

  useHotkeys(
    asking
      ? { Escape: () => setAsking(false), Enter: cancel }
      : {
          Escape: router.back,
          'Alt+B': change,
          'Alt+C': () => (cancelled ? undefined : setAsking(true)),
          'Ctrl+P': () => window.print(),
        },
  );
  useHints(
    asking
      ? ['Enter Cancel the bill', 'Esc Keep the bill']
      : [
          'Esc Back',
          ...(changeable ? ['Alt+B Change'] : []),
          ...(cancelled ? [] : ['Alt+C Cancel this bill']),
          'Ctrl+P Print',
        ],
  );

  return (
    <main className="page">
      <PageHeader
        title={`${label} ${bill.displayNumber}`}
        subtitle={`${formatDate(bill.date)}${bill.party ? ` · ${bill.party.name}` : ''}`}
        actions={
          <>
            <Button onClick={router.back}>Back (Esc)</Button>
            <Button onClick={() => window.print()}>Print</Button>
            {changeable && <Button onClick={change}>Change (Alt+B)</Button>}
            {!cancelled && (
              <Button variant="danger" onClick={() => setAsking(true)}>
                Cancel this bill (Alt+C)
              </Button>
            )}
          </>
        }
      />
      {cancelled && (
        <Notice>This bill has been cancelled. Its amounts no longer count in any report.</Notice>
      )}
      {bill.modifiedFromId && (
        <Notice kind="info">This bill replaces an earlier one that was changed.</Notice>
      )}
      {bill.refVoucher && (
        <p className="muted">
          Against bill {bill.refVoucher.displayNumber} dated {formatDate(bill.refVoucher.date)}
        </p>
      )}
      <div className="bill-meta">
        {bill.party && (
          <Card title={bill.party.name}>
            <p className="muted">
              {[bill.party.address, bill.party.phone, bill.party.gstin && `GST ${bill.party.gstin}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </Card>
        )}
        <Card>
          <p className="muted">
            Made by {bill.createdByName ?? 'unknown'}
            {bill.saleTypeName ? ` · ${bill.saleTypeName}` : ''}
            {bill.broker ? ` · Broker ${bill.broker}` : ''}
          </p>
          {bill.narration && <p>{bill.narration}</p>}
        </Card>
      </div>

      {bill.lines.length > 0 && (
        <DataTable
          rowKey={(r) => r.lineNo}
          rows={bill.lines}
          columns={[
            { header: '#', cell: (r) => r.lineNo },
            { header: 'Item', cell: (r) => r.itemName },
            { header: 'Quantity', num: true, cell: (r) => `${formatQty(r.qty)} ${r.unitName}` },
            { header: 'Price', num: true, cell: (r) => formatMoney(r.listPricePaise) },
            { header: 'Disc. %', num: true, cell: (r) => (r.discBp ? String(r.discBp / 100) : '') },
            {
              header: 'GST',
              num: true,
              cell: (r) => (r.taxRateBp ? formatPercent(r.taxRateBp) : ''),
            },
            {
              header: 'Amount',
              num: true,
              cell: (r) => (r.amountPaise ? formatMoney(r.amountPaise) : ''),
            },
          ]}
        />
      )}
      {bill.entries.length > 0 && bill.lines.length === 0 && (
        <DataTable
          rowKey={(r, i) => `${r.accountId}-${i}`}
          rows={bill.entries}
          columns={[
            { header: 'Account', cell: (r) => r.accountName },
            {
              header: 'Debit',
              num: true,
              cell: (r) => (r.side === 'dr' ? formatMoney(r.amountPaise) : ''),
            },
            {
              header: 'Credit',
              num: true,
              cell: (r) => (r.side === 'cr' ? formatMoney(r.amountPaise) : ''),
            },
          ]}
        />
      )}
      {bill.totalPaise > 0 && (
        <Card className="bill-totals">
          <dl className="totals">
            {bill.lines.length > 0 && (
              <>
                <div>
                  <dt>Items total</dt>
                  <dd>{formatMoney(bill.subtotalPaise)}</dd>
                </div>
                {bill.sundries.map((s) => (
                  <div key={s.billSundryId}>
                    <dt>{s.name}</dt>
                    <dd>{formatMoney(s.sign * s.amountPaise)}</dd>
                  </div>
                ))}
                <div>
                  <dt>GST</dt>
                  <dd>{formatMoney(bill.taxPaise)}</dd>
                </div>
                {bill.roundOffPaise !== 0 && (
                  <div>
                    <dt>Round off</dt>
                    <dd>{formatMoney(bill.roundOffPaise)}</dd>
                  </div>
                )}
              </>
            )}
            <div className="grand">
              <dt>Total</dt>
              <dd>{formatMoney(bill.totalPaise)}</dd>
            </div>
            {bill.settlements.map((s) => (
              <div key={s.accountId}>
                <dt>Paid in {s.accountName}</dt>
                <dd>{formatMoney(s.amountPaise)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {asking && (
        <div className="overlay">
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label="Cancel this bill?"
          >
            <h2>Cancel this bill?</h2>
            <p>
              {label} {bill.displayNumber} for {rupees(bill.totalPaise)} will be cancelled. Its
              stock and money are put back. It cannot be un-cancelled, but you can make a new bill.
            </p>
            <div className="field">
              <label htmlFor="cancel-reason">Why is it being cancelled?</label>
              <input
                id="cancel-reason"
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="field-note">{error ?? 'This is kept in the audit log.'}</div>
            </div>
            <div className="dialog-actions">
              <Button onClick={() => setAsking(false)}>No, keep it (Esc)</Button>
              <Button variant="danger" onClick={cancel}>
                Yes, cancel the bill (Enter)
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
