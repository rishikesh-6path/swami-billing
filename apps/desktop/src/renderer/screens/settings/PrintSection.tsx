import { useEffect, useRef, useState, type RefObject } from 'react';
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

/** Each card saves itself and says whether it worked; `quiet` leaves the message to F2. */
type Saver = RefObject<((quiet?: boolean) => Promise<boolean>) | null>;

export function PrintSection() {
  const toast = useToast();
  const settings = useCall('settings.get', {});
  const savePrintRef: Saver = useRef(null);
  const saveLabelsRef: Saver = useRef(null);
  // F2 saves both cards, so nothing typed on the page is left unsaved
  useHotkeys({
    F2: () => {
      void Promise.all([savePrintRef.current?.(true), saveLabelsRef.current?.(true)]).then(
        ([a, b]) => {
          if (a && b) toast.show('Printing and label sheet settings saved.');
          else if (a) toast.show('Printing settings saved.');
          else if (b) toast.show('Label sheet settings saved.');
        },
      );
    },
  });
  return (
    <LoadState state={settings}>
      {settings.status === 'ready' && (
        <>
          <PrintForm initial={settings.data.print} saverRef={savePrintRef} />
          <LabelSheetCard saverRef={saveLabelsRef} />
        </>
      )}
    </LoadState>
  );
}

function PrintForm({ initial, saverRef }: { initial: ShopSettings['print']; saverRef: Saver }) {
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const printers = useCall('print.printers', {});
  const [error, setError] = useState<string | null>(null);
  const save = (quiet = false) => {
    setError(null);
    return call('settings.savePrint', form).then(
      () => {
        if (!quiet) toast.show('Printing settings saved.');
        return true;
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : 'The settings could not be saved.');
        return false;
      },
    );
  };
  useEffect(() => {
    saverRef.current = save;
  });
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
        <SelectField
          label="Printer"
          value={form.printer}
          onChange={(e) => setForm({ ...form, printer: e.target.value })}
          hint={
            printers.status === 'ready' && printers.data.length === 0
              ? 'No printer was found on this computer. You can still save the bill as a PDF.'
              : 'Choose one to print without being asked each time, or leave "Ask me each time".'
          }
        >
          <option value="">Ask me each time</option>
          {printers.status === 'ready' &&
            [...new Set([...printers.data, ...(form.printer ? [form.printer] : [])])].map(
              (name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ),
            )}
        </SelectField>
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
        <Button variant="primary" onClick={() => void save()}>
          Save (F2)
        </Button>
      </p>
    </Card>
  );
}

/** mm typed by the owner (one decimal) to tenths of a millimetre, or null when not a number. */
function tenths(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '' || t === '-' || t === '+') return 0;
  if (!/^[+-]?(\d+(\.\d)?|\.\d)$/.test(t)) return null;
  return Math.round(Number(t) * 10);
}

/** Which label sheets the shop uses, and how far to move the print so it sits on the labels. */
function LabelSheetCard({ saverRef }: { saverRef: Saver }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const loaded = useCall('labels.settings', {});
  const [form, setForm] = useState<{ layout: '3x8' | '4x10'; top: string; left: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  if (loaded.status === 'ready' && form === null) {
    setForm({
      layout: loaded.data.layout,
      top: String(loaded.data.topTenthMm / 10),
      left: String(loaded.data.leftTenthMm / 10),
    });
  }
  const values = () => {
    if (!form) return null;
    const top = tenths(form.top);
    const left = tenths(form.left);
    if (top === null || left === null || Math.abs(top) > 50 || Math.abs(left) > 50) {
      setError('Please type a number of millimetres from -5 to 5, for example 1.5 or -0.5.');
      return null;
    }
    return { layout: form.layout, topTenthMm: top, leftTenthMm: left };
  };
  const save = (quiet = false) => {
    setError(null);
    const v = values();
    if (!v) return Promise.resolve(false);
    return call('labels.saveSettings', v).then(
      () => {
        if (!quiet) toast.show('Label sheet settings saved.');
        return true;
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : 'The settings could not be saved.');
        return false;
      },
    );
  };
  useEffect(() => {
    saverRef.current = form ? save : null;
  });
  const test = (action: 'print' | 'pdf') => {
    if (busy) return;
    setError(null);
    const v = values();
    if (!v) return;
    setBusy(true);
    call('labels.calibrate', { ...v, action }).then(
      ({ printed, saved }) => {
        setBusy(false);
        if (saved) toast.show(`Saved to ${saved}`);
        else if (printed) toast.show('The test sheet was sent to the printer.');
      },
      (e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : 'The test sheet could not be made.');
      },
    );
  };
  if (!form) return null;
  return (
    <Card title="Label sheets">
      <p className="muted">
        Print a test sheet on plain paper and hold it against a sheet of labels. If the boxes sit
        lower than the labels, type a minus number for "Move down"; if they sit to the right, a
        minus number for "Move right". Then save and print the test again.
      </p>
      {error && <Notice>{error}</Notice>}
      <div className="form-grid">
        <SelectField
          label="Label sheet"
          value={form.layout}
          onChange={(e) => setForm({ ...form, layout: e.target.value === '4x10' ? '4x10' : '3x8' })}
        >
          <option value="3x8">24 labels, 70 x 37 mm</option>
          <option value="4x10">40 small labels, 52.5 x 29.7 mm</option>
        </SelectField>
        <TextField
          label="Move down (mm)"
          inputMode="decimal"
          value={form.top}
          onChange={(e) => setForm({ ...form, top: e.target.value })}
          hint="For example 1.5 moves the print 1.5 mm down; -1.5 moves it up."
        />
        <TextField
          label="Move right (mm)"
          inputMode="decimal"
          value={form.left}
          onChange={(e) => setForm({ ...form, left: e.target.value })}
          hint="For example 1 moves the print 1 mm right; -1 moves it left."
        />
      </div>
      <p>
        <Button onClick={() => test('print')} disabled={busy}>
          Print a test sheet
        </Button>{' '}
        <Button onClick={() => test('pdf')} disabled={busy}>
          Save the test sheet as PDF
        </Button>{' '}
        <Button variant="primary" onClick={() => void save()}>
          Save label settings (F2)
        </Button>
      </p>
    </Card>
  );
}
