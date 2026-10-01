import { useState } from 'react';
import type { ShopSettings } from '../../../ipc/contract.ts';
import { DataTable } from '../../components/DataTable.tsx';
import {
  Button,
  Card,
  ConfirmDialog,
  LoadState,
  Notice,
  TextField,
  useToast,
} from '../../components/ui.tsx';
import { call, useCall } from '../../lib/api.ts';
import { formatDate, parseDateInput } from '../../lib/format.ts';
import { useSession } from '../../lib/session.tsx';

export function ClosingSection() {
  const loaded = useCall('settings.get', {});
  return (
    <LoadState state={loaded}>
      {loaded.status === 'ready' && (
        <ClosingBody initialBooks={loaded.data.books} initialYears={loaded.data.years} />
      )}
    </LoadState>
  );
}

function ClosingBody({
  initialBooks,
  initialYears,
}: {
  initialBooks: ShopSettings['books'];
  initialYears: ShopSettings['years'];
}) {
  const toast = useToast();
  const today = useSession().today;
  const [books, setBooks] = useState(initialBooks);
  const [years, setYears] = useState(initialYears);
  const [closeText, setCloseText] = useState(formatDate(today));
  const [lockText, setLockText] = useState(formatDate(today));
  const [error, setError] = useState<string | null>(null);
  const [confirmYear, setConfirmYear] = useState<ShopSettings['years'][number] | null>(null);

  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : 'That could not be done. Please try again.');
  const withDate = (text: string, run: (iso: string) => void) => {
    setError(null);
    const iso = parseDateInput(text, today);
    if (!iso) setError('Please type the date like 05-10-2026.');
    else run(iso);
  };
  const done = (message: string) => (b: ShopSettings['books']) => {
    setBooks(b);
    toast.show(message);
  };
  const dayText = books.dayClosedThrough
    ? `Days up to ${formatDate(books.dayClosedThrough)} are closed. Staff cannot change bills on those days.`
    : 'No day has been closed yet.';
  const lockedText = books.lockedThrough
    ? `The books are locked up to ${formatDate(books.lockedThrough)}. Nobody can change bills on those days.`
    : 'The books are not locked.';

  return (
    <>
      {error && <Notice>{error}</Notice>}
      <Card title="Close the day">
        <p>{dayText}</p>
        <p className="muted">
          Close a day after you have counted the cash. Staff can then no longer change or cancel
          that day&apos;s bills. You, as owner, still can.
        </p>
        <TextField
          label="Close all days up to"
          value={closeText}
          onChange={(e) => setCloseText(e.target.value)}
        />
        <p className="row-actions">
          <Button
            variant="primary"
            onClick={() =>
              withDate(
                closeText,
                (date) => void call('books.closeDay', { date }).then(done('Day closed.'), fail),
              )
            }
          >
            Close the day
          </Button>
          <Button
            disabled={!books.dayClosedThrough}
            onClick={() =>
              void call('books.reopenDay', { date: null }).then(done('All days reopened.'), fail)
            }
          >
            Reopen all days
          </Button>
        </p>
      </Card>

      <Card title="Lock the books after filing GST returns">
        <p>{lockedText}</p>
        <p className="muted">
          Once a GST return is filed, lock the books up to that date so no bill can be changed by
          mistake. To correct a bill later, make a return dated today.
        </p>
        <TextField
          label="Lock all days up to"
          value={lockText}
          onChange={(e) => setLockText(e.target.value)}
        />
        <p className="row-actions">
          <Button
            variant="primary"
            onClick={() =>
              withDate(
                lockText,
                (date) => void call('books.lock', { date }).then(done('Books locked.'), fail),
              )
            }
          >
            Lock the books
          </Button>
          <Button
            disabled={!books.lockedThrough}
            onClick={() => void call('books.unlock', {}).then(done('Books unlocked.'), fail)}
          >
            Unlock the books
          </Button>
        </p>
      </Card>

      <Card title="Financial years">
        <p className="muted">
          A year runs from 1 April to 31 March. Closing a year starts the next one: balances and
          stock carry forward and bill numbers begin again from 1.
        </p>
        <DataTable
          rows={years}
          rowKey={(y) => y.id}
          columns={[
            { header: 'Year', cell: (y) => y.label + (y.current ? ' (this year)' : '') },
            { header: 'From', cell: (y) => formatDate(y.startDate) },
            { header: 'To', cell: (y) => formatDate(y.endDate) },
            { header: 'Status', cell: (y) => (y.isLocked ? 'Closed' : 'Open') },
            {
              header: 'Action',
              cell: (y) =>
                y.isLocked ? null : (
                  <Button onClick={() => setConfirmYear(y)}>Close this year</Button>
                ),
            },
          ]}
        />
      </Card>

      {confirmYear && (
        <ConfirmDialog
          title={`Close the year ${confirmYear.label}?`}
          confirmLabel="Yes, close the year"
          cancelLabel="No, keep it open"
          danger
          onCancel={() => setConfirmYear(null)}
          onConfirm={() => {
            const fyId = confirmYear.id;
            setConfirmYear(null);
            setError(null);
            void call('books.closeYear', { fyId }).then((list) => {
              setYears(list);
              toast.show('The year has been closed and the next year is ready.');
            }, fail);
          }}
        >
          <p>
            No more bills can be made in {confirmYear.label} after this. Please take a backup first
            and make sure all returns for the year are done.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
