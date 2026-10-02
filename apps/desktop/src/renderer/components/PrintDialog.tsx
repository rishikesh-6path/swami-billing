import { useEffect, useState } from 'react';
import { call, useCall } from '../lib/api.ts';
import { useHotkeys } from '../lib/hotkeys.tsx';
import { useFocusTrap } from './focus.ts';
import { Button, LoadState, Notice, useToast } from './ui.tsx';

/**
 * Shows exactly what will be printed, on A4 paper or an 80 mm roll. Enter prints, Esc closes.
 * The preview runs in a locked-down frame: it can show the bill but cannot run anything.
 */
export function PrintDialog({
  id,
  initialSize,
  onClose,
}: {
  id: number;
  initialSize: 'a4' | 'thermal';
  onClose: () => void;
}) {
  const toast = useToast();
  const [size, setSize] = useState(initialSize);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = useCall('print.preview', { id, size });
  // opens on the Print button, so Enter prints as the dialog says
  const trap = useFocusTrap<HTMLDivElement>('#print-go');
  // a mouse click inside the preview puts the keyboard in that frame; bring it back to the dialog
  useEffect(() => {
    const back = () =>
      setTimeout(() => {
        if (document.activeElement?.tagName === 'IFRAME')
          document.getElementById('print-go')?.focus();
      }, 0);
    window.addEventListener('blur', back);
    return () => window.removeEventListener('blur', back);
  }, []);

  const print = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    call('print.run', { id, size }).then(
      ({ printed }) => {
        setBusy(false);
        if (printed) {
          toast.show('Sent to the printer.');
          onClose();
        } else {
          setError(
            'The bill was not printed. Please check the printer is on and has paper, or save it as a PDF.',
          );
        }
      },
      (e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : 'The bill could not be printed.');
      },
    );
  };
  const savePdf = () => {
    setError(null);
    call('print.pdf', { id, size }).then(
      ({ saved }) => {
        if (saved) toast.show(`Saved to ${saved}`);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'The PDF could not be saved.'),
    );
  };
  useHotkeys({ Escape: onClose, Enter: print }, true, true);

  return (
    <div className="overlay">
      <div
        ref={trap}
        className="dialog print-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Print preview"
      >
        <div className="print-head">
          <h2>Print</h2>
          <div className="field print-size">
            <label htmlFor="paper">Paper</label>
            <select
              id="paper"
              value={size}
              onChange={(e) => setSize(e.target.value === 'thermal' ? 'thermal' : 'a4')}
            >
              <option value="a4">A4 sheet</option>
              <option value="thermal">Receipt roll (80 mm)</option>
            </select>
          </div>
        </div>
        {error && <Notice>{error}</Notice>}
        <LoadState state={preview}>
          {preview.status === 'ready' && (
            <iframe
              title="Bill preview"
              tabIndex={-1}
              className={`print-frame print-frame-${size}`}
              sandbox=""
              srcDoc={preview.data.html}
            />
          )}
        </LoadState>
        <div className="dialog-actions">
          <Button onClick={onClose}>Close (Esc)</Button>
          <Button onClick={savePdf}>Save as PDF</Button>
          <Button id="print-go" variant="primary" disabled={busy} onClick={print}>
            {busy ? 'Printing...' : 'Print (Enter)'}
          </Button>
        </div>
      </div>
    </div>
  );
}
