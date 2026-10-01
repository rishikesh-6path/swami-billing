import { useState } from 'react';
import type { BackupStatus, RestoreCheck } from '../../../ipc/contract.ts';
import { DataTable } from '../../components/DataTable.tsx';
import { Button, Card, ConfirmDialog, LoadState, Notice, useToast } from '../../components/ui.tsx';
import { call, useCall } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';

const size = (bytes: number) =>
  bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;

export function BackupSection() {
  const loaded = useCall('backup.status', {});
  return (
    <LoadState state={loaded}>
      {loaded.status === 'ready' && <BackupBody initial={loaded.data} />}
    </LoadState>
  );
}

function BackupBody({ initial }: { initial: BackupStatus }) {
  const toast = useToast();
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<RestoreCheck | null>(null);
  const [restarting, setRestarting] = useState(false);

  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : 'That could not be done. Please try again.');

  const backUp = () => {
    setError(null);
    setBusy(true);
    call('backup.run', {}).then(
      (s) => {
        setBusy(false);
        setStatus(s);
        toast.show(
          s.copied === false
            ? 'Backup saved, but the second copy could not be made. Is the drive plugged in?'
            : 'Backup saved.',
          s.copied === false ? 'error' : 'success',
        );
      },
      (e: unknown) => {
        setBusy(false);
        fail(e);
      },
    );
  };
  const choose = (which: 'main' | 'copy', clear = false) =>
    void call('backup.chooseFolder', { which, clear }).then(setStatus, fail);
  const check = (path?: string) => {
    setError(null);
    call('backup.check', path ? { path } : {}).then((result) => {
      if (!result) return;
      if (!result.ok) setError(`This backup cannot be used. ${result.message}`);
      else setRestoring(result);
    }, fail);
  };
  const restore = (path: string) => {
    if (busy) return;
    setBusy(true);
    setRestoring(null);
    call('backup.restore', { path }).then(
      () => setRestarting(true),
      (e: unknown) => {
        setBusy(false);
        fail(e);
      },
    );
  };

  if (restarting) {
    return (
      <Card title="Restoring your data">
        <p>Your data has been restored. ShopLedger is restarting now. Please wait a few seconds.</p>
      </Card>
    );
  }

  return (
    <>
      {error && <Notice>{error}</Notice>}
      <Card title="Backup">
        <p>
          {status.lastAt
            ? `Last backup: ${formatDate(status.lastAt.slice(0, 10))} at ${status.lastAt.slice(11)}.`
            : 'No backup has been made yet.'}
        </p>
        <p className="muted">
          ShopLedger saves a backup by itself at 2 pm, at 8 pm and every time it is closed. The last
          30 days are kept, and one backup for each of the last 12 months.
        </p>
        <dl>
          <dt>Backups are kept in</dt>
          <dd data-testid="backup-folder">{status.folder}</dd>
          <dt>Second copy (for example a pen drive)</dt>
          <dd data-testid="backup-copy-folder">
            {status.copyFolder ??
              'Not set. Keep a copy away from this computer in case it is lost.'}
          </dd>
        </dl>
        <p className="row-actions">
          <Button variant="primary" onClick={backUp} disabled={busy}>
            {busy ? 'Saving...' : 'Back up now'}
          </Button>
          <Button onClick={() => choose('main')}>Change folder</Button>
          <Button onClick={() => choose('copy')}>
            {status.copyFolder ? 'Change second copy' : 'Choose a drive for a second copy'}
          </Button>
          {status.copyFolder && (
            <Button onClick={() => choose('copy', true)}>Stop second copy</Button>
          )}
        </p>
      </Card>

      <Card title="Saved backups">
        <DataTable
          rows={status.backups}
          rowKey={(b) => b.name}
          empty="There are no backups yet."
          columns={[
            { header: 'Date', cell: (b) => formatDate(b.date) },
            { header: 'Time', cell: (b) => b.time },
            {
              header: 'Kind',
              cell: (b) => (b.kind === 'before-restore' ? 'Saved before a restore' : 'Backup'),
            },
            { header: 'Size', cell: (b) => size(b.bytes), num: true },
            {
              header: 'Action',
              cell: (b) => <Button onClick={() => check(b.path)}>Restore</Button>,
            },
          ]}
        />
      </Card>

      <Card title="Restore from a file">
        <p className="muted">
          Use this if the computer was changed or the data was damaged. Your current data is saved
          first, so you can come back to it.
        </p>
        <Button onClick={() => check()}>Choose a backup file...</Button>
      </Card>

      {restoring && (
        <ConfirmDialog
          title="Go back to this backup?"
          confirmLabel="Yes, restore it"
          cancelLabel="No, keep my data"
          danger
          onCancel={() => setRestoring(null)}
          onConfirm={() => restore(restoring.path)}
        >
          <p>
            {restoring.takenAt
              ? `This backup was taken on ${formatDate(restoring.takenAt.slice(0, 10))} at ${restoring.takenAt.slice(11)}. `
              : ''}
            It holds {restoring.vouchers} bills and entries. Everything made after it was taken will
            be gone from the screen.
          </p>
          <p>
            The people who can sign in, their PINs, and any closed days or locked books will also go
            back to how they were then. Your current data is saved first (shown as "Saved before a
            restore" in the list), and ShopLedger will restart.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
