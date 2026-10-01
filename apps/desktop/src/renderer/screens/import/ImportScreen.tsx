import { useState } from 'react';
import type { ImportOutcome } from '../../../ipc/contract.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { Button, Card, Notice, PageHeader, useToast } from '../../components/ui.tsx';
import { call } from '../../lib/api.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';

type Kind = 'items' | 'customers' | 'suppliers';

const KINDS: { kind: Kind; key: string; title: string; columns: string; note: string }[] = [
  {
    kind: 'items',
    key: 'I',
    title: 'Items',
    columns:
      'Name, Alias, Group, Unit, HSN, GST %, Price, MRP, Opening stock, Opening rate, Min stock',
    note: 'Only the Name column is a must. Items that already exist are skipped.',
  },
  {
    kind: 'customers',
    key: 'C',
    title: 'Customers',
    columns: 'Name, Phone, GSTIN, State, Address, Credit days, Opening balance, Dr/Cr',
    note: 'Only the Name column is a must. Opening balance is what the customer owed you on the first day.',
  },
  {
    kind: 'suppliers',
    key: 'S',
    title: 'Suppliers',
    columns: 'Name, Phone, GSTIN, State, Address, Credit days, Opening balance, Dr/Cr',
    note: 'Only the Name column is a must. Opening balance is what you owed the supplier on the first day.',
  },
];

/** Adds many items, customers or suppliers at once from an Excel sheet saved as CSV. */
export function ImportScreen() {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<(ImportOutcome & { title: string }) | null>(null);

  const run = (kind: Kind, title: string) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    call('import.run', { kind }).then(
      (result) => {
        setBusy(false);
        if (result.cancelled) return;
        setOutcome({ ...result, title });
      },
      (e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : 'The file could not be read.');
      },
    );
  };
  const sample = (kind: Kind) =>
    void call('import.sample', { kind }).then(
      ({ saved }) => {
        if (saved) toast.show(`Sample sheet saved to ${saved}`);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'The sample could not be saved.'),
    );

  useHotkeys(Object.fromEntries(KINDS.map((k) => [k.key, () => run(k.kind, k.title)] as const)));
  useHints(['I Items', 'C Customers', 'S Suppliers', 'Esc Back']);

  return (
    <main className="page">
      <PageHeader
        title="Add from a Spreadsheet"
        subtitle="Save your Excel sheet as a CSV file, then choose it here. Each row is added on its own, so one wrong row never stops the rest."
      />
      {error && <Notice>{error}</Notice>}
      {outcome && (
        <Card title={`${outcome.title}: ${outcome.fileName}`}>
          <p role="status" data-testid="import-result">
            {outcome.created} added
            {outcome.skipped.length > 0 ? `, ${outcome.skipped.length} skipped` : ''}.
          </p>
          {outcome.skipped.length > 0 && (
            <>
              <p className="muted">
                These rows were not added. Fix them in your sheet and import the file again; rows
                that were already added are skipped automatically.
              </p>
              <DataTable
                rows={outcome.skipped}
                rowKey={(r) => r.row}
                columns={[
                  { header: 'Row in sheet', cell: (r) => r.row, num: true },
                  { header: 'Why it was skipped', cell: (r) => r.reason },
                ]}
              />
            </>
          )}
        </Card>
      )}
      {KINDS.map((k) => (
        <Card key={k.kind} title={k.title}>
          <p className="muted">Columns it understands: {k.columns}</p>
          <p className="muted">{k.note}</p>
          <p className="row-actions">
            <Button variant="primary" disabled={busy} onClick={() => run(k.kind, k.title)}>
              Choose a file to add ({k.key})
            </Button>
            <Button onClick={() => sample(k.kind)}>Save a sample sheet</Button>
          </p>
        </Card>
      ))}
    </main>
  );
}
