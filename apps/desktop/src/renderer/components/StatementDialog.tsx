import { useEffect, useState } from 'react';
import { call } from '../lib/api.ts';
import { useHotkeys } from '../lib/hotkeys.tsx';
import { PRESET_LABELS, presetRange, type Preset } from '../lib/periods.ts';
import { useSession } from '../lib/session.tsx';
import { useFocusTrap } from './focus.ts';
import { Button, Notice, useToast } from './ui.tsx';

const PERIODS: Exclude<Preset, 'custom' | 'today'>[] = [
  'thisYear',
  'thisQuarter',
  'thisMonth',
  'lastMonth',
];

/** Shows, prints or saves a statement of account for one customer or supplier. */
export function StatementDialog({ partyId, onClose }: { partyId: number; onClose: () => void }) {
  const toast = useToast();
  const { today, financialYear } = useSession();
  const [preset, setPreset] = useState<(typeof PERIODS)[number]>('thisYear');
  const range = presetRange(preset, today, financialYear);
  const to = range.to > today ? today : range.to;
  const req = { partyId, from: range.from, to };
  const key = JSON.stringify(req);
  const [page, setPage] = useState<{ key: string; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trap = useFocusTrap<HTMLDivElement>('#statement-go');

  useEffect(() => {
    let live = true;
    call('statement.preview', JSON.parse(key) as typeof req).then(
      (p) => {
        if (live) setPage({ key, html: p.html });
      },
      (e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'The statement could not be shown.');
      },
    );
    return () => {
      live = false;
    };
  }, [key]);

  const print = () => {
    if (busy) return;
    setBusy(true);
    call('statement.print', req).then(
      ({ printed }) => {
        setBusy(false);
        if (printed) {
          toast.show('The statement was sent to the printer.');
          onClose();
        } else {
          setError(
            'The statement was not printed. If you closed the print window, nothing is wrong; otherwise please check the printer, or save it as a PDF.',
          );
        }
      },
      (e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : 'The statement could not be printed.');
      },
    );
  };
  const savePdf = () => {
    if (busy) return;
    setBusy(true);
    call('statement.pdf', req).then(
      ({ saved }) => {
        setBusy(false);
        if (saved) {
          toast.show(`Saved to ${saved}`);
          onClose();
        }
      },
      (e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : 'The PDF could not be saved.');
      },
    );
  };
  useHotkeys({ Escape: onClose, Enter: print, 'Ctrl+S': savePdf }, true, true);

  return (
    <div className="overlay">
      <div
        ref={trap}
        className="dialog print-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Statement of account"
      >
        <div className="print-head">
          <h2>Statement of account</h2>
          <div className="field print-size">
            <label htmlFor="statement-period">Period</label>
            <select
              id="statement-period"
              value={preset}
              onChange={(e) => setPreset(e.target.value as (typeof PERIODS)[number])}
            >
              {PERIODS.map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {error && <Notice>{error}</Notice>}
        {page && page.key === key && (
          <iframe
            title="Statement preview"
            tabIndex={-1}
            className="print-frame"
            sandbox=""
            srcDoc={page.html}
          />
        )}
        <div className="dialog-actions">
          <Button onClick={onClose}>Close (Esc)</Button>
          <Button onClick={savePdf} disabled={busy}>
            Save as PDF (Ctrl+S)
          </Button>
          <Button id="statement-go" variant="primary" disabled={busy} onClick={print}>
            {busy ? 'Working...' : 'Print (Enter)'}
          </Button>
        </div>
      </div>
    </div>
  );
}
