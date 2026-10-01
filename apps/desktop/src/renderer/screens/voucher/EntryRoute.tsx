import type { VoucherDetail } from '@shopledger/core';
import { LoadState } from '../../components/ui.tsx';
import { useCall } from '../../lib/api.ts';
import { useRouter, type EntryKind } from '../../lib/router.tsx';
import { CashVoucher } from './CashVoucher.tsx';
import { JournalVoucher } from './JournalVoucher.tsx';

/** Opens a receipt, payment, journal or contra screen, empty or filled with an existing entry. */
export function EntryRoute({ kind, editId }: { kind: EntryKind; editId: number | undefined }) {
  if (editId === undefined) return <Screen kind={kind} />;
  return <EditLoader kind={kind} editId={editId} />;
}

function Screen({ kind, edit }: { kind: EntryKind; edit?: VoucherDetail | undefined }) {
  if (kind === 'receipt' || kind === 'payment') return <CashVoucher kind={kind} edit={edit} />;
  return <JournalVoucher kind={kind} edit={edit} />;
}

function EditLoader({ kind, editId }: { kind: EntryKind; editId: number }) {
  const router = useRouter();
  const detail = useCall('voucher.get', { id: editId });
  return (
    <LoadState state={detail}>
      {detail.status === 'ready' && detail.data ? (
        <Screen kind={kind} edit={detail.data} />
      ) : (
        <main className="page">
          <p>That entry could not be found.</p>
          <button type="button" className="btn" onClick={router.back}>
            Go back
          </button>
        </main>
      )}
    </LoadState>
  );
}
