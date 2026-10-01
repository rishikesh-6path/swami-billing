import { useState } from 'react';
import type { SessionState } from '../../ipc/contract.ts';
import { Button, Card, Notice, SelectField, TextField } from '../components/ui.tsx';
import { call, useCall } from '../lib/api.ts';
import { useHotkeys } from '../lib/hotkeys.tsx';

/** Shown once, the first time ShopLedger is opened on a new computer. */
export function Setup({ onDone }: { onDone: (state: SessionState) => void }) {
  const states = useCall('lookup.states', {});
  const [form, setForm] = useState({
    shopName: '',
    address: '',
    stateCode: '33',
    gstin: '',
    phone: '',
    ownerName: '',
    ownerPin: '',
    confirmPin: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = () => {
    if (busy) return;
    if (form.ownerPin !== form.confirmPin) {
      setError('The two PINs are not the same. Please type them again.');
      return;
    }
    setBusy(true);
    setError(null);
    call('setup.complete', {
      shopName: form.shopName,
      address: form.address,
      stateCode: form.stateCode,
      gstin: form.gstin,
      phone: form.phone,
      ownerName: form.ownerName,
      ownerPin: form.ownerPin,
    }).then(onDone, (e: unknown) => {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      setBusy(false);
    });
  };
  useHotkeys({ F2: submit });

  return (
    <main className="centered">
      <Card className="narrow">
        <h1>Welcome to ShopLedger</h1>
        <p className="muted">
          Let us set up your shop. This takes about a minute and is done only once.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <h2>Your shop</h2>
          <TextField label="Shop name" value={form.shopName} onChange={set('shopName')} autoFocus />
          <TextField
            label="Address"
            value={form.address}
            onChange={set('address')}
            hint="Printed on your bills."
          />
          <SelectField
            label="State"
            value={form.stateCode}
            onChange={set('stateCode')}
            hint="Needed to work out GST correctly."
          >
            {states.status === 'ready' ? (
              states.data.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))
            ) : (
              <option value="33">Tamil Nadu</option>
            )}
          </SelectField>
          <TextField
            label="GST number (if you have one)"
            value={form.gstin}
            onChange={set('gstin')}
            hint="15 letters and digits, from your GST certificate."
          />
          <TextField
            label="Phone number"
            value={form.phone}
            onChange={set('phone')}
            inputMode="tel"
          />

          <h2>Owner sign-in</h2>
          <TextField label="Your name" value={form.ownerName} onChange={set('ownerName')} />
          <TextField
            label="Choose a PIN"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={form.ownerPin}
            onChange={set('ownerPin')}
            hint="4 to 6 digits. You will use it every time you open ShopLedger."
          />
          <TextField
            label="Type the PIN again"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={form.confirmPin}
            onChange={set('confirmPin')}
          />

          {error && <Notice>{error}</Notice>}
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Setting up...' : 'Finish setup'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
