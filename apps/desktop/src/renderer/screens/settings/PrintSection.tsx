import { useState } from 'react';
import type { ShopSettings } from '../../../ipc/contract.ts';
import {
  Button,
  Card,
  LoadState,
  Notice,
  SelectField,
  TextField,
  useToast,
} from '../../components/ui.tsx';
import { call, useCall } from '../../lib/api.ts';
import { useHotkeys } from '../../lib/hotkeys.tsx';

export function PrintSection() {
  const settings = useCall('settings.get', {});
  return (
    <LoadState state={settings}>
      {settings.status === 'ready' && <PrintForm initial={settings.data.print} />}
    </LoadState>
  );
}

function PrintForm({ initial }: { initial: ShopSettings['print'] }) {
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    setError(null);
    call('settings.savePrint', form).then(
      () => toast.show('Printing settings saved.'),
      (e: unknown) => setError(e instanceof Error ? e.message : 'The settings could not be saved.'),
    );
  };
  useHotkeys({ F2: save });
  return (
    <Card title="Printing">
      {error && <Notice>{error}</Notice>}
      <div className="form-grid">
        <SelectField
          label="Paper"
          value={form.size}
          onChange={(e) =>
            setForm({ ...form, size: e.target.value === 'thermal' ? 'thermal' : 'a4' })
          }
          hint="What the bill is printed on by default."
        >
          <option value="a4">A4 sheet</option>
          <option value="thermal">Receipt roll (80 mm)</option>
        </SelectField>
        <TextField
          label="Printer name"
          value={form.printer}
          onChange={(e) => setForm({ ...form, printer: e.target.value })}
          hint="Leave empty to choose the printer each time. Type the name exactly as Windows shows it to print without asking."
        />
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={form.auto}
          onChange={(e) => setForm({ ...form, auto: e.target.checked })}
        />{' '}
        Show the print screen right after saving a sale
      </label>
      <p>
        <Button variant="primary" onClick={save}>
          Save (F2)
        </Button>
      </p>
    </Card>
  );
}
