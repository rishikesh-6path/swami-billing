import { LoadState } from '../../components/ui.tsx';
import { useCall } from '../../lib/api.ts';
import { useRouter, type ItemVoucherKind, type StartParty } from '../../lib/router.tsx';
import { ItemVoucher } from './ItemVoucher.tsx';

/** Opens the bill screen empty, or filled with an existing bill when `editId` is given. */
export function VoucherRoute({
  kind,
  editId,
  copyId,
  party,
}: {
  kind: ItemVoucherKind;
  editId: number | undefined;
  copyId?: number | undefined;
  party?: StartParty | undefined;
}) {
  if (copyId !== undefined) return <EditLoader kind={kind} editId={copyId} copy />;
  if (editId === undefined) return <ItemVoucher kind={kind} startParty={party} />;
  return <EditLoader kind={kind} editId={editId} />;
}

function EditLoader({
  kind,
  editId,
  copy = false,
}: {
  kind: ItemVoucherKind;
  editId: number;
  copy?: boolean;
}) {
  const router = useRouter();
  const detail = useCall('voucher.get', { id: editId });
  return (
    <LoadState state={detail}>
      {detail.status === 'ready' && detail.data ? (
        copy ? (
          <ItemVoucher kind={kind} copyFrom={detail.data} />
        ) : (
          <ItemVoucher kind={kind} edit={detail.data} />
        )
      ) : (
        <main className="page">
          <p>That bill could not be found.</p>
          <button type="button" className="btn" onClick={router.back}>
            Go back
          </button>
        </main>
      )}
    </LoadState>
  );
}
