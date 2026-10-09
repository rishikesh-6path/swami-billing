import { useEffect, useState } from 'react';
import type { Req } from '../../ipc/contract.ts';
import { call } from '../lib/api.ts';
import { useHotkeys } from '../lib/hotkeys.tsx';
import { useFocusTrap } from './focus.ts';
import { Button, Notice, useToast } from './ui.tsx';

type Draft = Req<'estimate.preview'>['draft'];

/**
 * Shows, prints or saves an estimate of the sale on the screen. Nothing is saved to the books:
 * the bill stays on the screen to be saved later, set aside or thrown away.
 */
export function EstimateDialog({
  draft,
  initialSize,
  onClose,
}: {
  draft: Draft;
  initialSize: 'a4' | 'thermal';
  onClose: () => void;
}) {
  const toast = useToast();
  const [size, setSize] = useState(initialSize);
  const [html, setHtml] = useState<{ size: string; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trap = useFocusTrap<HTMLDivElement>('#estimate-go');

  useEffect(() => {
    let live = true;
    call('estimate.preview', { draft, size }).then(
      (p) => {
        if (live) setHtml({ size, html: p.html });
      },
      (e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'The estimate could not be shown.');
      },
    );
    return () => {
      live = false;
    };
  }, [draft, size]);

  const print = () => {
    if (busy || error) return;
    setBusy(true);
    call('estimate.print', { draft, size }).then(
      ({ printed }) => {
        setBusy(false);
        if (printed) {
          toast.show('The estimate was sent to the printer. The bill is still on the screen.');
          onClose();
        } else {
          setError(
            'The estimate was not printed. If you closed the print window, nothing is wrong; otherwise please check the printer, or save it as a PDF.',
          );
        }
      },
      (e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : 'The estimate could not be printed.');
      },
    );
  };
  const savePdf = () => {
    if (busy || error) return;
    setBusy(true);
    call('estimate.pdf', { draft, size }).then(
      ({ saved }) => {
        setBusy(false);
        if (saved) {
          toast.show(`Saved to ${saved}. The bill is still on the screen.`);
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
        aria-label="Estimate"
      >
        <div className="print-head">
          <h2>Estimate</h2>
          <div className="field print-size">
            <label htmlFor="estimate-paper">Paper</label>
            <select
              id="estimate-paper"
              value={size}
              onChange={(e) => setSize(e.target.value === 'thermal' ? 'thermal' : 'a4')}
            >
              <option value="a4">A4 sheet</option>
              <option value="thermal">Receipt roll (80 mm)</option>
            </select>
          </div>
        </div>
        <p className="muted">
          An estimate is not a bill: it has no number and is not saved in the accounts.
        </p>
        {error && <Notice>{error}</Notice>}
        {html && html.size === size && (
          <iframe
            title="Estimate preview"
            tabIndex={-1}
            className={`print-frame print-frame-${size}`}
            sandbox=""
            srcDoc={html.html}
          />
        )}
        <div className="dialog-actions">
          <Button onClick={onClose}>Close (Esc)</Button>
          <Button onClick={savePdf} disabled={busy || Boolean(error)}>
            Save as PDF (Ctrl+S)
          </Button>
          <Button
            id="estimate-go"
            variant="primary"
            disabled={busy || Boolean(error)}
            onClick={print}
          >
            {busy ? 'Working...' : 'Print (Enter)'}
          </Button>
        </div>
      </div>
    </div>
  );
}
