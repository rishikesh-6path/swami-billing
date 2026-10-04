import { useState } from 'react';
import type { PriceChangeRow } from '@shopledger/core';
import { DataTable } from '../../components/DataTable.tsx';
import {
  Button,
  Card,
  ConfirmDialog,
  Notice,
  PageHeader,
  SelectField,
  TextField,
  useToast,
} from '../../components/ui.tsx';
import { call, useCall } from '../../lib/api.ts';
import { formatMoney, parsePercent } from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter } from '../../lib/router.tsx';

/** The owner raises or lowers the selling prices of many items at once, after seeing the result. */
export function PriceChangeScreen() {
  const router = useRouter();
  const toast = useToast();
  const groups = useCall('itemgroup.list', {});
  const [groupId, setGroupId] = useState('');
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [percent, setPercent] = useState('');
  const [rounding, setRounding] = useState<'rupee' | 'fifty' | 'exact'>('rupee');
  const [alsoMrp, setAlsoMrp] = useState(false);
  const [rows, setRows] = useState<PriceChangeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const request = () => {
    const bp = parsePercent(percent);
    if (bp === null || bp <= 0) {
      setError('Please type how many per cent to add or take off, for example 10.');
      return null;
    }
    return {
      ...(groupId ? { groupId: Number(groupId) } : {}),
      percentBp: direction === 'up' ? bp : -bp,
      alsoMrp,
      rounding,
    };
  };
  const changed =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setRows(null); // the list on screen no longer matches the choices
    };

  const show = () => {
    setError(null);
    const req = request();
    if (!req || busy) return;
    setBusy(true);
    call('price.preview', req).then(
      (found) => {
        setBusy(false);
        setRows(found);
        if (found.length === 0) setError('No price would change with these choices.');
      },
      (e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : 'The new prices could not be worked out.');
      },
    );
  };
  const apply = () => {
    const req = request();
    if (!req || busy) return;
    setAsking(false);
    setBusy(true);
    call('price.apply', req).then(
      ({ changed: n }) => {
        toast.show(`Done. The prices of ${n} ${n === 1 ? 'item' : 'items'} were changed.`);
        router.back();
      },
      (e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : 'The prices could not be changed.');
      },
    );
  };
  const primary = () => {
    if (rows && rows.length > 0) setAsking(true);
    else show();
  };
  useHotkeys({ F2: primary, Escape: asking ? () => setAsking(false) : router.back }, true, asking);
  useHints(['F2 Show the new prices, then save them', 'Esc Back']);

  return (
    <main className="page">
      <PageHeader
        title="Change Prices"
        subtitle="Raise or lower the selling prices of many items at once. Bills already made keep their prices."
        actions={
          <>
            <Button onClick={router.back}>Back (Esc)</Button>
            <Button variant="primary" disabled={busy} onClick={primary}>
              {rows && rows.length > 0 ? 'Save these prices (F2)' : 'Show the new prices (F2)'}
            </Button>
          </>
        }
      />
      {error && <Notice>{error}</Notice>}
      <Card>
        <SelectField
          label="Which items"
          value={groupId}
          onChange={(e) => changed(setGroupId)(e.target.value)}
          autoFocus
        >
          <option value="">All items</option>
          {groups.status === 'ready' &&
            groups.data.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
        </SelectField>
        <SelectField
          label="Make prices"
          value={direction}
          onChange={(e) => changed(setDirection)(e.target.value === 'down' ? 'down' : 'up')}
        >
          <option value="up">Higher</option>
          <option value="down">Lower</option>
        </SelectField>
        <TextField
          label="By how many per cent"
          inputMode="decimal"
          value={percent}
          onChange={(e) => changed(setPercent)(e.target.value)}
          hint="For example 10 for ten per cent."
        />
        <SelectField
          label="Round the new price to"
          value={rounding}
          onChange={(e) =>
            changed(setRounding)(
              e.target.value === 'fifty' ? 'fifty' : e.target.value === 'exact' ? 'exact' : 'rupee',
            )
          }
        >
          <option value="rupee">The nearest rupee</option>
          <option value="fifty">The nearest 50 paise</option>
          <option value="exact">The exact paisa</option>
        </SelectField>
        <label className="check">
          <input
            type="checkbox"
            checked={alsoMrp}
            onChange={(e) => changed(setAlsoMrp)(e.target.checked)}
          />{' '}
          Change the printed (MRP) price as well
        </label>
      </Card>
      {rows && rows.length > 0 && (
        <>
          <p className="muted">
            {rows.length} {rows.length === 1 ? 'item' : 'items'} will change. Check the list, then
            press F2 to save.
          </p>
          <DataTable
            rowKey={(r) => r.itemId}
            rows={rows}
            empty=""
            columns={[
              { header: 'Group', cell: (r) => r.groupName },
              { header: 'Item', cell: (r) => r.name },
              { header: 'Now', num: true, cell: (r) => formatMoney(r.oldSalePaise) },
              { header: 'New price', num: true, cell: (r) => formatMoney(r.newSalePaise) },
              ...(alsoMrp
                ? [
                    {
                      header: 'MRP now',
                      num: true,
                      cell: (r: PriceChangeRow) => formatMoney(r.oldMrpPaise),
                    },
                    {
                      header: 'New MRP',
                      num: true,
                      cell: (r: PriceChangeRow) => formatMoney(r.newMrpPaise),
                    },
                  ]
                : []),
            ]}
          />
        </>
      )}
      {asking && rows && (
        <ConfirmDialog
          title="Change these prices?"
          confirmLabel="Yes, change the prices"
          cancelLabel="No, go back"
          onConfirm={apply}
          onCancel={() => setAsking(false)}
        >
          The selling prices of {rows.length} {rows.length === 1 ? 'item' : 'items'} will change.
          Every change is recorded in Who Did What. Bills already made are not touched.
        </ConfirmDialog>
      )}
    </main>
  );
}
