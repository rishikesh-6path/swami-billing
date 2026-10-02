import { useState } from 'react';
import type { SessionState } from '../../../ipc/contract.ts';
import { Button, Card, LoadState, Notice, TextField, useToast } from '../../components/ui.tsx';
import { call, useCall } from '../../lib/api.ts';
import { useHotkeys } from '../../lib/hotkeys.tsx';

/** Screen locking and the information a support person asks for. */
export function SupportSection({ onSession }: { onSession: (s: SessionState) => void }) {
  const settings = useCall('settings.get', {});
  return (
    <LoadState state={settings}>
      {settings.status === 'ready' && (
        <SupportBody
          minutes={settings.data.lockMinutes}
          about={settings.data.about}
          onSession={onSession}
        />
      )}
    </LoadState>
  );
}

function SupportBody({
  minutes,
  about,
  onSession,
}: {
  minutes: number;
  about: { appVersion: string; dbPath: string; schemaVersion: number };
  onSession: (s: SessionState) => void;
}) {
  const toast = useToast();
  const [text, setText] = useState(String(minutes));
  const [error, setError] = useState<string | null>(null);

  const saveLock = () => {
    setError(null);
    const n = Number(text.trim());
    if (!Number.isInteger(n) || n < 0 || n > 480) {
      setError('Please type a whole number of minutes from 0 to 480. Type 0 to never lock.');
      return;
    }
    call('settings.saveLock', { minutes: n }).then(
      () => {
        toast.show(n === 0 ? 'The screen will not lock.' : `The screen locks after ${n} minutes.`);
        void call('session.state', {}).then(onSession);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'The setting could not be saved.'),
    );
  };
  useHotkeys({ F2: saveLock });

  const saveSupport = () => {
    setError(null);
    call('support.save', {}).then(
      ({ saved }) => {
        if (saved) toast.show(`Saved to ${saved}. Send this file to whoever supports you.`);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'The file could not be saved.'),
    );
  };

  return (
    <>
      {error && <Notice>{error}</Notice>}
      <Card title="Lock the screen when nobody is using it">
        <p className="muted">
          After this many minutes without a key or the mouse, ShopLedger hides the screen and asks
          for the PIN. A bill being made is kept. Type 0 to never lock.
        </p>
        <TextField
          label="Minutes before locking"
          inputMode="numeric"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <Button variant="primary" onClick={saveLock}>
          Save (F2)
        </Button>
      </Card>
      <Card title="Help from support">
        <p className="muted">
          If something is not working, save this file and send it to the person who supports you. It
          tells them about the program and the data file. It does not contain your bills, customers,
          amounts or PINs.
        </p>
        <Button onClick={saveSupport}>Save information for support</Button>
        <dl>
          <dt>Program version</dt>
          <dd>{about.appVersion}</dd>
          <dt>Data version</dt>
          <dd>{about.schemaVersion}</dd>
          <dt>Data file</dt>
          <dd>{about.dbPath}</dd>
        </dl>
      </Card>
    </>
  );
}
