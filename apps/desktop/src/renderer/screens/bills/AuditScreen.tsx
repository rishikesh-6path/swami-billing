import { useState } from 'react';
import { DataTable } from '../../components/DataTable.tsx';
import { Button, LoadState, PageHeader } from '../../components/ui.tsx';
import { useCall } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import { useHints, useHotkeys } from '../../lib/hotkeys.tsx';
import { useRouter } from '../../lib/router.tsx';

const ACTIONS: Record<string, string> = {
  create: 'Made',
  update: 'Changed',
  delete: 'Deleted',
  cancel: 'Cancelled',
  modify: 'Replaced after a change',
  save_company: 'Shop details saved',
  change_pin: 'PIN changed',
  close_day: 'Day closed',
  reopen_day: 'Day reopened',
  lock_books: 'Books locked',
  unlock_books: 'Books unlocked',
  close_year: 'Year closed',
  reopen_year: 'Year reopened',
  set_tax_rate: 'GST rate changed',
  login: 'Signed in',
  login_failed: 'Wrong PIN typed',
  login_locked: 'Locked out after wrong PINs',
};

/** Who did what and when, for the owner. */
export function AuditScreen() {
  const router = useRouter();
  const [text, setText] = useState('');
  const log = useCall('audit.list', text.trim() ? { text: text.trim() } : {});
  useHotkeys({ Escape: router.back });
  useHints(['Type to search', 'Esc Back']);
  return (
    <main className="page">
      <PageHeader
        title="Who Did What"
        subtitle="Every bill made, changed or cancelled, and every change to your items and customers."
        actions={<Button onClick={router.back}>Back (Esc)</Button>}
      />
      <div className="field">
        <label htmlFor="audit-search">Search by person, action or bill</label>
        <input id="audit-search" autoFocus value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <LoadState state={log}>
        <DataTable
          rowKey={(r) => r.id}
          rows={log.status === 'ready' ? log.data : []}
          empty="Nothing recorded yet."
          columns={[
            {
              header: 'When',
              cell: (r) => formatDateTime(r.at),
            },
            { header: 'Who', cell: (r) => r.userName ?? 'System' },
            { header: 'What happened', cell: (r) => ACTIONS[r.action] ?? r.action },
            { header: 'About', cell: (r) => r.description },
            { header: 'Reason', cell: (r) => r.reason },
          ]}
        />
      </LoadState>
    </main>
  );
}
