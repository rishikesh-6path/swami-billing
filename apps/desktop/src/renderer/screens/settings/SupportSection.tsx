import { useState } from 'react';
import type { BookHealth } from '@shopledger/core';
import type { SessionState } from '../../../ipc/contract.ts';
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
import { parsePercent } from '../../lib/format.ts';
import { useHotkeys } from '../../lib/hotkeys.tsx';

/** Screen locking and the information a support person asks for. */
export function SupportSection({ onSession }: { onSession: (s: SessionState) => void }) {
  const settings = useCall('settings.get', {});
  return (
    <LoadState state={settings}>
      {settings.status === 'ready' && (
        <SupportBody
          minutes={settings.data.lockMinutes}
          maxDiscountBp={settings.data.staffMaxDiscountBp}
          about={settings.data.about}
          paper={settings.data.print.size}
          onSession={onSession}
        />
      )}
    </LoadState>
  );
}

function SupportBody({
  minutes,
  maxDiscountBp,
  about,
  paper,
  onSession,
}: {
  minutes: number;
  maxDiscountBp: number;
  about: { appVersion: string; dbPath: string; schemaVersion: number };
  paper: 'a4' | 'thermal';
  onSession: (s: SessionState) => void;
}) {
  const toast = useToast();
  const [text, setText] = useState(String(minutes));
  const [discountText, setDiscountText] = useState(
    maxDiscountBp === 0 ? '' : String(maxDiscountBp / 100),
  );
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
        toast.show(
          n === 0
            ? 'The screen will not lock.'
            : `The screen locks after ${n} ${n === 1 ? 'minute' : 'minutes'}.`,
        );
        void call('session.state', {}).then(onSession);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'The setting could not be saved.'),
    );
  };
  useHotkeys({ F2: saveLock });

  const saveLimits = () => {
    setError(null);
    const bp = discountText.trim() === '' ? 0 : parsePercent(discountText);
    if (bp === null || bp < 0 || bp > 10000) {
      setError('Please type a discount between 0 and 100. Leave it empty for no limit.');
      return;
    }
    call('settings.saveLimits', { staffMaxDiscountBp: bp }).then(
      () =>
        toast.show(
          bp === 0 ? 'Staff can give any discount.' : `Staff can give up to ${bp / 100}% discount.`,
        ),
      (e: unknown) => setError(e instanceof Error ? e.message : 'The limit could not be saved.'),
    );
  };

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
      <Card title="Discount staff may give">
        <p className="muted">
          Staff cannot save a bill with a bigger discount than this on any item, or taken off at the
          bottom of the bill. The owner has no limit. Leave empty for no limit.
        </p>
        <TextField
          label="Most discount staff may give (%)"
          inputMode="decimal"
          value={discountText}
          onChange={(e) => setDiscountText(e.target.value)}
        />
        <Button variant="primary" onClick={saveLimits}>
          Save the limit
        </Button>
      </Card>
      <ComputerCheckCard paper={paper} />
      <BookCheckCard />
      <Card title="About this computer">
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

/** Runs the book checks and says plainly what was found and what to do. */
function BookCheckCard() {
  const [health, setHealth] = useState<BookHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    call('support.checkBooks', {}).then(
      (h) => {
        setHealth(h);
        setBusy(false);
      },
      (e: unknown) => {
        setBusy(false);
        setError(e instanceof Error ? e.message : 'The check could not be run.');
      },
    );
  };
  return (
    <Card title="Check my books">
      <p className="muted">
        Reads every bill and entry and checks that the accounts, stock and bill numbers still add
        up. It changes nothing and takes a few seconds. Run it once a month, or when something looks
        wrong.
      </p>
      <Button onClick={run} disabled={busy}>
        {busy ? 'Checking...' : 'Check my books now'}
      </Button>
      {error && <Notice>{error}</Notice>}
      {health && (
        <>
          <Notice kind={health.ok ? 'info' : 'error'}>
            {health.ok
              ? 'All is well. Your books add up.'
              : 'Something does not add up. Please take a backup now (Settings > Backup and restore), do not change the bills listed below, then press "Save information for support" below and send that file to whoever supports you.'}
          </Notice>
          <ul className="check-list">
            {health.checks.map((c) => (
              <li key={c.title} className={c.ok ? 'check-ok' : 'check-bad'}>
                <strong>{c.ok ? 'OK' : 'Problem'}:</strong> {c.message}
                {c.examples.length > 0 && <span className="muted"> ({c.examples.join(', ')})</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

type Step = { title: string; state: 'waiting' | 'working' | 'ok' | 'bad'; message: string };

const STEPS = ['Printer', 'Backup', 'Books'] as const;

/**
 * For the first day on a new computer, and after any change to it: prints a test page on the
 * bill printer, makes a backup and reads it back, and checks the books. One line per step.
 */
function ComputerCheckCard({ paper }: { paper: 'a4' | 'thermal' }) {
  const [size, setSize] = useState(paper);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const busy = steps?.some((s) => s.state === 'working' || s.state === 'waiting') ?? false;
  const set = (i: number, state: Step['state'], message: string) =>
    setSteps((all) => all?.map((s, k) => (k === i ? { ...s, state, message } : s)) ?? null);
  const failed = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

  const run = async () => {
    if (busy) return;
    setSteps(STEPS.map((title) => ({ title, state: 'waiting', message: '' })));
    set(0, 'working', 'Printing a test page...');
    try {
      const { printed } = await call('selftest.print', { size });
      if (printed) {
        set(
          0,
          'ok',
          'A test page was sent to the printer. Check that its border shows on all four sides.',
        );
      } else {
        set(
          0,
          'bad',
          'The test page was not printed. Please check the printer is on and has paper, and is chosen in Settings > Printing.',
        );
      }
    } catch (e) {
      set(0, 'bad', failed(e, 'The test page could not be printed.'));
    }
    set(1, 'working', 'Making a backup and reading it back...');
    try {
      const b = await call('selftest.backup', {});
      set(1, b.ok ? 'ok' : 'bad', b.message);
    } catch (e) {
      set(1, 'bad', failed(e, 'The backup could not be made.'));
    }
    set(2, 'working', 'Checking the books...');
    try {
      const h = await call('support.checkBooks', {});
      set(
        2,
        h.ok ? 'ok' : 'bad',
        h.ok
          ? 'The books add up.'
          : 'Something does not add up. Run "Check my books now" below to see what.',
      );
    } catch (e) {
      set(2, 'bad', failed(e, 'The books could not be checked.'));
    }
  };

  const done = steps !== null && !busy;
  const allOk = done && steps.every((s) => s.state === 'ok');
  return (
    <Card title="Check this computer">
      <p className="muted">
        Do this on the first day, and after a new printer, pen drive or computer. It prints a test
        page on the bill printer, makes a backup and reads it back (also from the pen drive), and
        checks the books. Nothing in the books is changed.
      </p>
      <div className="form-grid">
        <SelectField
          label="Test page paper"
          value={size}
          onChange={(e) => setSize(e.target.value === 'thermal' ? 'thermal' : 'a4')}
        >
          <option value="a4">A4 sheet</option>
          <option value="thermal">Receipt roll (80 mm)</option>
        </SelectField>
      </div>
      <Button onClick={() => void run()} disabled={busy}>
        {busy ? 'Checking...' : 'Check this computer'}
      </Button>
      {done && (
        <Notice kind={allOk ? 'info' : 'error'}>
          {allOk
            ? 'All three checks passed.'
            : 'Not everything passed. Fix what is marked "Problem" and run the check again.'}
        </Notice>
      )}
      {steps && (
        <ul className="check-list" aria-label="Computer check results">
          {steps.map((s) => (
            <li
              key={s.title}
              className={s.state === 'bad' ? 'check-bad' : s.state === 'ok' ? 'check-ok' : ''}
            >
              <strong>
                {s.title}:{' '}
                {s.state === 'ok'
                  ? 'OK'
                  : s.state === 'bad'
                    ? 'Problem'
                    : s.state === 'working'
                      ? 'Working'
                      : 'Waiting'}
              </strong>{' '}
              {s.message}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
