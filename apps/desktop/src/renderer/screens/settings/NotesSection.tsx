import { useEffect, useState } from 'react';
import { Button, Card, Notice, SelectField, useToast } from '../../components/ui.tsx';
import { call } from '../../lib/api.ts';
import { useHotkeys } from '../../lib/hotkeys.tsx';

type Kind = 'sales' | 'purchase' | 'sales_return' | 'purchase_return';
const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'sales', label: 'Sale' },
  { kind: 'purchase', label: 'Purchase' },
  { kind: 'sales_return', label: 'Sales Return' },
  { kind: 'purchase_return', label: 'Purchase Return' },
];

/** The short notes staff pick with F4 on a bill. One note per line. */
export function NotesSection() {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('sales');
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    call('narrations.get', { kind }).then(
      (notes) => {
        if (!cancelled) setText(notes.join('\n'));
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'The notes could not be loaded.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const save = () => {
    setError(null);
    call('narrations.save', { kind, notes: (text ?? '').split('\n') }).then(
      (notes) => {
        setText(notes.join('\n'));
        toast.show('Standard notes saved.');
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'The notes could not be saved.'),
    );
  };
  useHotkeys({ F2: save });

  return (
    <Card title="Standard notes">
      <p className="muted">
        Staff press F4 on a bill to pick one of these notes instead of typing. Write one note on
        each line.
      </p>
      {error && <Notice>{error}</Notice>}
      <SelectField
        label="Notes for"
        value={kind}
        onChange={(e) => {
          setText(null);
          setKind(e.target.value as Kind);
        }}
      >
        {KINDS.map((k) => (
          <option key={k.kind} value={k.kind}>
            {k.label}
          </option>
        ))}
      </SelectField>
      <div className="field">
        <label htmlFor="notes-text">Notes (one on each line)</label>
        <textarea
          id="notes-text"
          rows={8}
          value={text ?? ''}
          disabled={text === null}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <Button variant="primary" onClick={save} disabled={text === null}>
        Save (F2)
      </Button>
    </Card>
  );
}
