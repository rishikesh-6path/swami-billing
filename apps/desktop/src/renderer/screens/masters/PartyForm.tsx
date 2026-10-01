import { useState } from 'react';
import type { AccountRow } from '@shopledger/core';
import {
  Button,
  ConfirmDialog,
  LoadState,
  Notice,
  PageHeader,
  SelectField,
  TextField,
  useToast,
} from '../../components/ui.tsx';
import { enterMovesNext } from '../../components/FormKeys.ts';
import { call, useCall } from '../../lib/api.ts';
import { formatMoney, parseMoney } from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter, type PartyKind } from '../../lib/router.tsx';

export function PartyForm({ kind, id }: { kind: PartyKind; id: number | undefined }) {
  return id === undefined ? (
    <WithStates kind={kind} id={undefined} existing={null} />
  ) : (
    <EditLoader kind={kind} id={id} />
  );
}

function EditLoader({ kind, id }: { kind: PartyKind; id: number }) {
  const router = useRouter();
  const found = useCall('party.get', { id });
  return (
    <LoadState state={found}>
      {found.status === 'ready' && found.data ? (
        <WithStates kind={kind} id={id} existing={found.data} />
      ) : (
        <main className="page">
          <p>That record could not be found.</p>
          <Button onClick={router.back}>Go back</Button>
        </main>
      )}
    </LoadState>
  );
}

function WithStates({
  kind,
  id,
  existing,
}: {
  kind: PartyKind;
  id: number | undefined;
  existing: AccountRow | null;
}) {
  const states = useCall('lookup.states', {});
  return (
    <LoadState state={states}>
      {states.status === 'ready' && (
        <Form kind={kind} id={id} existing={existing} states={states.data} />
      )}
    </LoadState>
  );
}

function Form({
  kind: initialKind,
  id,
  existing,
  states,
}: {
  kind: PartyKind;
  id: number | undefined;
  existing: AccountRow | null;
  states: { code: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [kind, setKind] = useState<PartyKind>(initialKind);
  const [f, setF] = useState({
    name: existing?.name ?? '',
    phone: existing?.phone ?? '',
    address: existing?.address ?? '',
    stateCode: existing?.stateCode ?? '',
    gstin: existing?.gstin ?? '',
    creditDays: String(existing?.creditDays ?? 0),
    opening: existing ? formatMoney(existing.openingBalancePaise) : '',
    openingIsDr: existing?.openingIsDr ?? initialKind === 'customer',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => {
    setDirty(true);
    setF((x) => ({ ...x, [key]: e.target.value }));
  };
  const word = kind === 'customer' ? 'customer' : 'supplier';

  const save = async () => {
    if (busy) return;
    setError(null);
    const opening = f.opening.trim() === '' ? 0 : parseMoney(f.opening);
    const days = Number(f.creditDays || '0');
    if (opening === null || opening < 0)
      return setError('The opening balance is not a valid amount.');
    if (!Number.isInteger(days) || days < 0) return setError('Credit days must be a whole number.');
    setBusy(true);
    try {
      await call('party.save', {
        ...(id !== undefined ? { id } : { kind }),
        name: f.name,
        gstin: f.gstin.trim() || null,
        stateCode: f.stateCode || null,
        phone: f.phone.trim() || null,
        address: f.address.trim() || null,
        creditDays: days,
        openingBalancePaise: opening,
        openingIsDr: f.openingIsDr,
      });
      toast.show(`Saved "${f.name.trim()}".`);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong and nothing was saved.');
      setBusy(false);
    }
  };

  const leave = () => (dirty ? setConfirm('leave') : router.back());
  useHotkeys({ F2: () => void save(), Escape: leave });
  useHints(['F2 Save', 'Enter Next box', 'Esc Cancel']);

  return (
    <main className="page">
      <PageHeader
        title={id === undefined ? `Add ${word}` : `Change ${word}`}
        actions={
          <>
            {id !== undefined && (
              <Button variant="danger" onClick={() => setConfirm('delete')}>
                Delete
              </Button>
            )}
            <Button onClick={leave}>Cancel (Esc)</Button>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              Save (F2)
            </Button>
          </>
        }
      />
      {error && <Notice>{error}</Notice>}
      <form onSubmit={(e) => e.preventDefault()} onKeyDown={enterMovesNext(() => void save())}>
        <div className="form-grid">
          {id === undefined && (
            <SelectField
              label="This is a"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value === 'supplier' ? 'supplier' : 'customer');
                setF((x) => ({ ...x, openingIsDr: e.target.value !== 'supplier' }));
              }}
            >
              <option value="customer">Customer (buys from you)</option>
              <option value="supplier">Supplier (you buy from them)</option>
            </SelectField>
          )}
          <TextField label="Name" value={f.name} onChange={set('name')} autoFocus />
          <TextField label="Phone number" value={f.phone} onChange={set('phone')} inputMode="tel" />
          <TextField label="Address" value={f.address} onChange={set('address')} />
          <SelectField
            label="State"
            value={f.stateCode}
            onChange={set('stateCode')}
            hint="Needed for bills to other states (IGST)."
          >
            <option value="">Not given</option>
            {states.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label="GST number (if they have one)"
            value={f.gstin}
            onChange={set('gstin')}
            hint="15 letters and digits. Leave empty for a customer without GST."
          />
          <TextField
            label="Credit days"
            value={f.creditDays}
            onChange={set('creditDays')}
            inputMode="numeric"
            hint="How many days they are allowed to pay."
          />
          <TextField
            label="Balance when you started"
            value={f.opening}
            onChange={set('opening')}
            inputMode="decimal"
          />
          <SelectField
            label="That balance means"
            value={f.openingIsDr ? 'dr' : 'cr'}
            onChange={(e) => {
              setDirty(true);
              setF((x) => ({ ...x, openingIsDr: e.target.value === 'dr' }));
            }}
          >
            <option value="dr">They owe us</option>
            <option value="cr">We owe them</option>
          </SelectField>
        </div>
      </form>
      {confirm === 'leave' && (
        <ConfirmDialog
          title="Leave without saving?"
          confirmLabel="Yes, leave"
          cancelLabel="No, keep working"
          danger
          onConfirm={router.back}
          onCancel={() => setConfirm(null)}
        >
          You have changed something that is not saved.
        </ConfirmDialog>
      )}
      {confirm === 'delete' && id !== undefined && (
        <ConfirmDialog
          title={`Delete this ${word}?`}
          confirmLabel="Yes, delete"
          cancelLabel="No"
          danger
          onConfirm={() =>
            void call('party.delete', { id }).then(
              () => {
                toast.show('Deleted.');
                router.back();
              },
              (e: unknown) => {
                setConfirm(null);
                setError(e instanceof Error ? e.message : 'It could not be deleted.');
              },
            )
          }
          onCancel={() => setConfirm(null)}
        >
          Anyone who already has bills or payments cannot be deleted.
        </ConfirmDialog>
      )}
    </main>
  );
}
