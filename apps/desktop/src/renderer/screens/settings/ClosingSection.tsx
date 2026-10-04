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
  const [reopenText, setReopenText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sure, setSure] = useState<{ title: string; words: string; run: () => void } | null>(null);
  const [confirmYear, setConfirmYear] = useState<ShopSettings['years'][number] | null>(null);
  const [reopenYear, setReopenYear] = useState<ShopSettings['years'][number] | null>(null);

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
              withDate(closeText, (date) =>
                setSure({
                  title: `Close all days up to ${formatDate(date)}?`,
                  words:
                    'Staff will not be able to change or cancel any bill on those days. You can reopen them later.',
                  run: () => void call('books.closeDay', { date }).then(done('Day closed.'), fail),
                }),
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
        {books.dayClosedThrough && (
          <>
            <TextField
              label="Or reopen only the latest days: keep closed up to"
              value={reopenText}
              placeholder={formatDate(books.dayClosedThrough)}
              onChange={(e) => setReopenText(e.target.value)}
              hint="Days after this date open again. Earlier days stay closed."
            />
            <p>
              <Button
                onClick={() =>
                  withDate(reopenText, (date) => {
                    if (!books.dayClosedThrough || date >= books.dayClosedThrough) {
                      setError(
                        `Days are closed only up to ${formatDate(books.dayClosedThrough ?? date)}. Please choose an earlier date.`,
                      );
                      return;
                    }
                    void call('books.reopenDay', { date }).then(
                      done(`Days after ${formatDate(date)} are open again.`),
                      fail,
                    );
                  })
                }
              >
                Reopen the days after this date
              </Button>
            </p>
          </>
        )}
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
              withDate(lockText, (date) =>
                setSure({
                  title: `Lock the books up to ${formatDate(date)}?`,
                  words:
                    'Nobody, not even you, will be able to change or cancel bills on those days, and opening balances cannot be changed. Only do this after your GST return for that period is filed. You can unlock the books later.',
                  run: () => void call('books.lock', { date }).then(done('Books locked.'), fail),
                }),
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
          A year runs from 1 April to 31 March. The new year starts by itself on 1 April, with
          balances and stock carried forward and bill numbers starting again from 1. The old year
          stays open for late bills and returns; close it once your accountant has finished with it.
          A closed year can be opened again here if something must be corrected.
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
                y.isLocked ? (
                  <Button onClick={() => setReopenYear(y)}>Open this year again</Button>
                ) : (
                  <Button onClick={() => setConfirmYear(y)}>Close this year</Button>
                ),
            },
          ]}
        />
      </Card>

      {sure && (
        <ConfirmDialog
          title={sure.title}
          confirmLabel="Yes, do it"
          cancelLabel="No, not now"
          danger
          onCancel={() => setSure(null)}
          onConfirm={() => {
            const run = sure.run;
            setSure(null);
            setError(null);
            run();
          }}
        >
          <p>{sure.words}</p>
        </ConfirmDialog>
      )}
      {reopenYear && (
        <ConfirmDialog
          title={`Open the year ${reopenYear.label} again?`}
          confirmLabel="Yes, open it again"
          cancelLabel="No, keep it closed"
          danger
          onCancel={() => setReopenYear(null)}
          onConfirm={() => {
            const fyId = reopenYear.id;
            setReopenYear(null);
            setError(null);
            void call('books.reopenYear', { fyId }).then((list) => {
              setYears(list);
              toast.show('The year is open again. This is recorded in Who Did What.');
            }, fail);
          }}
        >
          <p>
            Bills can then be made and changed in {reopenYear.label} again (except for dates the
            books are locked for). Changes there also change the balances carried into later years,
            and your accountant may have already used its figures, so please tell them.
          </p>
        </ConfirmDialog>
      )}
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
