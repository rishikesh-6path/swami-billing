import { useEffect, useState } from 'react';
import type { HeldBill } from '@shopledger/core';
import { useFocusTrap } from '../../components/focus.ts';
import { Button, ConfirmDialog } from '../../components/ui.tsx';
import { useHotkeys } from '../../lib/hotkeys.tsx';
import { formatDateTime } from '../../lib/format.ts';

/**
 * The bills set aside on this kind of screen. Enter on the first bill brings it back; throwing a
 * bill away asks first, because it cannot be undone.
 */
export function HeldBillsDialog({
  bills,
  showOwner,
  onPick,
  onThrowAway,
  onClose,
}: {
  bills: HeldBill[];
  /** The owner sees everyone's bills, so the person who set each one aside is shown. */
  showOwner: boolean;
  onPick: (id: number) => void;
  onThrowAway: (id: number) => void;
  onClose: () => void;
}) {
  const trap = useFocusTrap<HTMLDivElement>('[data-first]');
  const [asking, setAsking] = useState<HeldBill | null>(null);
  useHotkeys({ Escape: asking ? () => setAsking(null) : onClose }, true, true);
  // after a bill is thrown away, focus goes back to the first bill left
  const count = bills.length;
  useEffect(() => {
    if (!asking) trap.current?.querySelector<HTMLElement>('[data-first]')?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asking, count]);
  return (
    <div className="overlay">
      <div
        ref={trap}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Bills set aside"
      >
        <h2>Bills set aside</h2>
        <div className="dialog-body">
          <p className="muted">Choose a bill to bring it back.</p>
          <ul className="pick-list">
            {bills.map((h, i) => (
              <li key={h.id}>
                <Button {...(i === 0 ? { 'data-first': '' } : {})} onClick={() => onPick(h.id)}>
                  {h.label}
                  {showOwner ? ` (${h.userName}, ${formatDateTime(h.createdAt)})` : ''}
                </Button>{' '}
                <Button variant="danger" onClick={() => setAsking(h)}>
                  Throw away
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <div className="dialog-actions">
          <Button onClick={onClose}>Close (Esc)</Button>
        </div>
      </div>
      {asking && (
        <ConfirmDialog
          title="Throw this bill away?"
          confirmLabel="Yes, throw it away"
          cancelLabel="No, keep it"
          danger
          onConfirm={() => {
            const id = asking.id;
            setAsking(null);
            onThrowAway(id);
          }}
          onCancel={() => setAsking(null)}
        >
          {asking.label} will be gone for good.
        </ConfirmDialog>
      )}
    </div>
  );
}
