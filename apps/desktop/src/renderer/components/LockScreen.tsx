import { useState } from 'react';
import { call } from '../lib/api.ts';
import { useHotkeys } from '../lib/hotkeys.tsx';
import { useFocusTrap } from './focus.ts';
import { Button, Notice } from './ui.tsx';

/**
 * Covers the whole window after a few minutes without use, so a bill on the screen cannot be seen
 * or changed by someone walking past. The screens underneath stay as they were: the same person
 * types their PIN and carries on. Switching user signs out, which drops a half-made bill.
 */
export function LockScreen({
  userName,
  onUnlocked,
  onSwitchUser,
}: {
  userName: string;
  onUnlocked: () => void;
  onSwitchUser: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trap = useFocusTrap<HTMLFormElement>();
  // nothing behind the lock may react to a key
  useHotkeys({}, true, true);

  const submit = () => {
    if (busy || pin === '') return;
    setBusy(true);
    setError(null);
    call('auth.unlock', { pin }).then(onUnlocked, (e: unknown) => {
      setBusy(false);
      setPin('');
      setError(e instanceof Error ? e.message : 'That PIN was not right. Please try again.');
    });
  };

  return (
    <div className="lock-cover" role="presentation">
      <form
        ref={trap}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Screen locked"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2>ShopLedger is locked</h2>
        <p>{userName}, please type your PIN to carry on. Nothing you were doing has been lost.</p>
        {error && <Notice>{error}</Notice>}
        <div className="field">
          <label htmlFor="unlock-pin">Your PIN</label>
          <input
            id="unlock-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </div>
        <div className="dialog-actions">
          <Button onClick={onSwitchUser}>Someone else (loses an unsaved bill)</Button>
          <Button variant="primary" type="submit" disabled={busy}>
            Unlock (Enter)
          </Button>
        </div>
      </form>
    </div>
  );
}
