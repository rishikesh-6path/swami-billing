import { useState } from 'react';
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
import {
  formatDate,
  formatMoney,
  formatPercent,
  formatQty,
  parseDateInput,
  parseMoney,
  parsePercent,
  parseQty,
} from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter } from '../../lib/router.tsx';
import { useSession } from '../../lib/session.tsx';
import type { ItemDetail } from '../../../ipc/contract.ts';

export function ItemForm({ id }: { id: number | undefined }) {
  return id === undefined ? <WithLists id={undefined} existing={null} /> : <EditLoader id={id} />;
}

function EditLoader({ id }: { id: number }) {
  const router = useRouter();
  const detail = useCall('item.get', { id });
  return (
    <LoadState state={detail}>
      {detail.status === 'ready' && detail.data ? (
        <WithLists id={id} existing={detail.data} />
      ) : (
        <main className="page">
          <p>That item could not be found.</p>
          <Button onClick={router.back}>Go back</Button>
        </main>
      )}
    </LoadState>
  );
}

function WithLists({ id, existing }: { id: number | undefined; existing: ItemDetail | null }) {
  const groups = useCall('itemgroup.list', {});
  const units = useCall('unit.list', {});
  const state =
    groups.status === 'error'
      ? groups
      : units.status === 'error'
        ? units
        : groups.status === 'ready' && units.status === 'ready'
          ? { status: 'ready' as const }
          : { status: 'loading' as const };
  return (
    <LoadState state={state}>
      {groups.status === 'ready' && units.status === 'ready' && (
        <Form
          id={id}
          existing={existing}
          groups={groups.data}
          units={units.data}
          reloadGroups={groups.reload}
          reloadUnits={units.reload}
        />
      )}
    </LoadState>
  );
}

function Form({
  id,
  existing,
  groups,
  units,
  reloadGroups,
  reloadUnits,
}: {
  id: number | undefined;
  existing: ItemDetail | null;
  groups: { id: number; name: string }[];
  units: { id: number; name: string; decimals: number }[];
  reloadGroups: () => void;
  reloadUnits: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { today, user } = useSession();
  const item = existing?.item;
  // staff can add items, but only the owner changes the price of an existing one
  const priceLocked = item !== undefined && user?.role !== 'owner';
  const [f, setF] = useState({
    name: item?.name ?? '',
    alias: item?.alias ?? '',
    groupId: item?.groupId ?? groups[0]?.id ?? 0,
    unitId: item?.unitId ?? units[0]?.id ?? 0,
    hsn: item?.hsn ?? '',
    gst: item?.rateBp != null ? String(item.rateBp / 100) : '18',
    price: item ? formatMoney(item.salePricePaise) : '',
    mrp: item ? formatMoney(item.mrpPaise) : '',
    openingQty: item ? formatQty(item.openingQty) : '',
    openingRate: item ? formatMoney(item.openingRatePaise) : '',
    minStock: item ? formatQty(item.minStockQty) : '',
    isActive: item?.isActive ?? true,
    gstFrom: formatDate(today),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState<'leave' | 'delete' | null>(null);
  const [newGroup, setNewGroup] = useState<string | null>(null);
  const [newUnit, setNewUnit] = useState<{ name: string; decimals: boolean } | null>(null);
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => {
    setDirty(true);
    setF((x) => ({ ...x, [key]: e.target.value }));
  };

  const rateChanged =
    item !== undefined && item.rateBp !== null && parsePercent(f.gst) !== item.rateBp;

  const save = async () => {
    if (busy) return;
    setError(null);
    const price = f.price.trim() === '' ? 0 : parseMoney(f.price);
    const mrp = f.mrp.trim() === '' ? 0 : parseMoney(f.mrp);
    const openingRate = f.openingRate.trim() === '' ? 0 : parseMoney(f.openingRate);
    const openingQty = f.openingQty.trim() === '' ? 0 : parseQty(f.openingQty);
    const minStock = f.minStock.trim() === '' ? 0 : parseQty(f.minStock);
    const gst = f.gst.trim() === '' ? undefined : parsePercent(f.gst);
    if (price === null || mrp === null || openingRate === null)
      return setError('One of the prices is not a valid amount.');
    if (openingQty === null || minStock === null)
      return setError('A quantity is not a valid number (at most 3 decimals).');
    if (gst === null) return setError('The GST rate is not a valid percentage.');
    const from = rateChanged ? parseDateInput(f.gstFrom, today) : undefined;
    if (rateChanged && !from)
      return setError('Please type the date the new GST rate starts from, like 05-10-2026.');
    setBusy(true);
    try {
      await call('item.save', {
        ...(id !== undefined ? { id, isActive: f.isActive } : {}),
        name: f.name,
        alias: f.alias.trim() || null,
        groupId: f.groupId,
        unitId: f.unitId,
        hsn: f.hsn.trim() || null,
        openingQty,
        openingRatePaise: openingRate,
        salePricePaise: price,
        mrpPaise: mrp,
        minStockQty: minStock,
        ...(gst !== undefined ? { taxRateBp: gst } : {}),
        ...(from ? { taxEffectiveFrom: from } : {}),
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
        title={id === undefined ? 'Add Item' : 'Change Item'}
        subtitle="Items must have a GST rate and an HSN code before they can be sold."
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
          <TextField label="Item name" value={f.name} onChange={set('name')} autoFocus />
          <TextField
            label="Code (short code to type at the counter)"
            value={f.alias}
            onChange={set('alias')}
            hint="For example 1500. You can type this instead of the name."
          />
          <div>
            <SelectField
              label="Group"
              value={f.groupId}
              onChange={(e) => {
                setDirty(true);
                setF((x) => ({ ...x, groupId: Number(e.target.value) }));
              }}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </SelectField>
            {newGroup === null ? (
              <Button onClick={() => setNewGroup('')}>New group</Button>
            ) : (
              <div className="inline-add">
                <input
                  aria-label="New group name"
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                  placeholder="Group name"
                />
                <Button
                  variant="primary"
                  onClick={() =>
                    void call('itemgroup.create', { name: newGroup }).then(
                      (gid) => {
                        reloadGroups();
                        setF((x) => ({ ...x, groupId: gid }));
                        setNewGroup(null);
                      },
                      (e: unknown) =>
                        setError(e instanceof Error ? e.message : 'Could not add the group.'),
                    )
                  }
                >
                  Add
                </Button>
              </div>
            )}
          </div>
          <div>
            <SelectField
              label="Unit"
              value={f.unitId}
              onChange={(e) => {
                setDirty(true);
                setF((x) => ({ ...x, unitId: Number(e.target.value) }));
              }}
              hint={existing ? 'The unit cannot be changed once the item has been billed.' : ''}
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </SelectField>
            {newUnit === null ? (
              <Button onClick={() => setNewUnit({ name: '', decimals: false })}>New unit</Button>
            ) : (
              <div className="inline-add">
                <input
                  aria-label="New unit name"
                  value={newUnit.name}
                  onChange={(e) => setNewUnit({ ...newUnit, name: e.target.value })}
                  placeholder="Unit name"
                />
                <label className="check">
                  <input
                    type="checkbox"
                    checked={newUnit.decimals}
                    onChange={(e) => setNewUnit({ ...newUnit, decimals: e.target.checked })}
                  />{' '}
                  Can be sold in parts (like 2.5)
                </label>
                <Button
                  variant="primary"
                  onClick={() =>
                    void call('unit.create', {
                      name: newUnit.name,
                      allowDecimals: newUnit.decimals,
                    }).then(
                      (uid) => {
                        reloadUnits();
                        setF((x) => ({ ...x, unitId: uid }));
                        setNewUnit(null);
                      },
                      (e: unknown) =>
                        setError(e instanceof Error ? e.message : 'Could not add the unit.'),
                    )
                  }
                >
                  Add
                </Button>
              </div>
            )}
          </div>
          <TextField
            label="HSN code"
            value={f.hsn}
            onChange={set('hsn')}
            hint="4 to 8 digits, from your CA or the GST rate list."
          />
          <TextField
            label="GST rate (%)"
            value={f.gst}
            onChange={set('gst')}
            inputMode="decimal"
            hint={
              rateChanged
                ? 'Changing the rate: bills already made keep their old rate.'
                : 'For example 18 or 5.'
            }
          />
          {rateChanged && (
            <TextField label="New rate applies from" value={f.gstFrom} onChange={set('gstFrom')} />
          )}
          <TextField
            label="Sale price"
            value={f.price}
            onChange={set('price')}
            inputMode="decimal"
            readOnly={priceLocked}
            {...(priceLocked ? { hint: 'Only the owner can change the price.' } : {})}
          />
          <TextField
            label="MRP (optional)"
            value={f.mrp}
            onChange={set('mrp')}
            inputMode="decimal"
            readOnly={priceLocked}
          />
          <TextField
            label="Quantity in stock when you started"
            value={f.openingQty}
            onChange={set('openingQty')}
            inputMode="decimal"
          />
          <TextField
            label="Cost per unit of that stock"
            value={f.openingRate}
            onChange={set('openingRate')}
            inputMode="decimal"
          />
          <TextField
            label="Tell me when stock falls below"
            value={f.minStock}
            onChange={set('minStock')}
            inputMode="decimal"
          />
        </div>
        {id !== undefined && (
          <label className="check">
            <input
              type="checkbox"
              checked={f.isActive}
              onChange={(e) => {
                setDirty(true);
                setF((x) => ({ ...x, isActive: e.target.checked }));
              }}
            />{' '}
            This item is in use (untick to hide it from the counter)
          </label>
        )}
        {item?.rateBp != null && !rateChanged && (
          <p className="muted">Current GST rate: {formatPercent(item.rateBp)}</p>
        )}
        {existing && existing.taxHistory.length > 1 && (
          <details>
            <summary>GST rate history</summary>
            <ul>
              {existing.taxHistory.map((h) => (
                <li key={h.effectiveFrom}>
                  {formatPercent(h.rateBp)} from {formatDate(h.effectiveFrom)}
                </li>
              ))}
            </ul>
          </details>
        )}
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
          title="Delete this item?"
          confirmLabel="Yes, delete it"
          cancelLabel="No"
          danger
          onConfirm={() =>
            void call('item.delete', { id }).then(
              () => {
                toast.show('Item deleted.');
                router.back();
              },
              (e: unknown) => {
                setConfirm(null);
                setError(e instanceof Error ? e.message : 'The item could not be deleted.');
              },
            )
          }
          onCancel={() => setConfirm(null)}
        >
          An item that has been billed cannot be deleted; you can untick "in use" instead.
        </ConfirmDialog>
      )}
    </main>
  );
}
