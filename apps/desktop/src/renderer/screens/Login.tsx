import { useState } from 'react';
import type { SessionState } from '../../ipc/contract.ts';
import { Button, Card, Notice, TextField } from '../components/ui.tsx';
import { call, useCall } from '../lib/api.ts';

export function Login({
  shopName,
  onDone,
}: {
  shopName: string;
  onDone: (state: SessionState) => void;
}) {
  const users = useCall('auth.users', {});
  const [picked, setPicked] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list = users.status === 'ready' ? users.data : [];
  const name = picked ?? (list.length === 1 ? list[0]!.name : null);

  const submit = () => {
    if (busy || !name) return;
    setBusy(true);
    setError(null);
    call('auth.login', { name, pin }).then(onDone, (e: unknown) => {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setPin('');
      setBusy(false);
    });
  };

  return (
    <main className="centered">
      <Card className="narrow">
        <h1>{shopName}</h1>
        <p className="muted">Who is signing in?</p>
        <div className="user-list" role="radiogroup" aria-label="Choose your name">
          {list.map((u) => (
            <button
              key={u.id}
              type="button"
              role="radio"
              aria-checked={u.name === name}
              className={`user-pick ${u.name === name ? 'user-pick-on' : ''}`}
              onClick={() => setPicked(u.name)}
            >
              {u.name}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <TextField
            label="Your PIN"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
            disabled={!name}
            hint={
              name
                ? `Signing in as ${name}. Press Enter when done.`
                : 'Please choose your name above first.'
            }
          />
          {error && <Notice>{error}</Notice>}
          <Button type="submit" variant="primary" disabled={busy || !name || pin.length < 4}>
            Sign in
          </Button>
        </form>
      </Card>
    </main>
  );
}
