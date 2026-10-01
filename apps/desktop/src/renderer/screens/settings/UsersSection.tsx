import { useState } from 'react';
import type { UserRow } from '@shopledger/core';
import { DataTable } from '../../components/DataTable.tsx';
import {
  Button,
  Card,
  ConfirmDialog,
  LoadState,
  Notice,
  SelectField,
  TextField,
  useToast,
} from '../../components/ui.tsx';
import { call, useCall } from '../../lib/api.ts';
import { useHotkeys } from '../../lib/hotkeys.tsx';
import { useSession } from '../../lib/session.tsx';

export function UsersSection() {
  const loaded = useCall('users.list', {});
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const list = users ?? (loaded.status === 'ready' ? loaded.data : null);
  return (
    <LoadState state={loaded}>{list && <UsersBody users={list} onChange={setUsers} />}</LoadState>
  );
}

function UsersBody({ users, onChange }: { users: UserRow[]; onChange: (u: UserRow[]) => void }) {
  const toast = useToast();
  const me = useSession().user;
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', pin: '', role: 'staff' as 'owner' | 'staff' });
  const [pinFor, setPinFor] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState<{
    user: UserRow;
    patch: { role?: 'owner' | 'staff'; isActive?: boolean };
    words: string;
  } | null>(null);

  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : 'That could not be done. Please try again.');
  const add = () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    call('users.create', form).then(
      (list) => {
        setBusy(false);
        onChange(list);
        setForm({ name: '', pin: '', role: 'staff' });
        toast.show('Person added.');
      },
      (e: unknown) => {
        setBusy(false);
        fail(e);
      },
    );
  };
  const update = (id: number, patch: { role?: 'owner' | 'staff'; isActive?: boolean }) => {
    setError(null);
    call('users.update', { id, ...patch }).then((list) => {
      onChange(list);
      toast.show('Saved.');
    }, fail);
  };

  return (
    <>
      <Card title="People who use ShopLedger">
        <p className="muted">
          Staff can make bills and see daily reports. Owners can also see profit, change settings
          and close days.
        </p>
        {error && <Notice>{error}</Notice>}
        <DataTable
          rows={users}
          rowKey={(u) => u.id}
          rowClass={(u) => (u.isActive ? '' : 'row-muted')}
          columns={[
            { header: 'Name', cell: (u) => u.name + (u.id === me?.id ? ' (you)' : '') },
            {
              header: 'Can do',
              cell: (u) => (u.role === 'owner' ? 'Everything (owner)' : 'Billing (staff)'),
            },
            { header: 'Status', cell: (u) => (u.isActive ? 'Can sign in' : 'Stopped') },
            {
              header: 'Actions',
              cell: (u) => (
                <span className="row-actions">
                  <Button onClick={() => setPinFor(u)}>Change PIN</Button>
                  {u.id !== me?.id && (
                    <>
                      <Button
                        onClick={() =>
                          setSure({
                            user: u,
                            patch: { role: u.role === 'owner' ? 'staff' : 'owner' },
                            words:
                              u.role === 'owner'
                                ? `${u.name} will no longer be able to see profit, change settings or close days.`
                                : `${u.name} will be able to see profit, change settings, close days and manage people.`,
                          })
                        }
                      >
                        Make {u.role === 'owner' ? 'staff' : 'owner'}
                      </Button>
                      <Button
                        onClick={() =>
                          setSure({
                            user: u,
                            patch: { isActive: !u.isActive },
                            words: u.isActive
                              ? `${u.name} will not be able to sign in until you allow access again.`
                              : `${u.name} will be able to sign in again.`,
                          })
                        }
                      >
                        {u.isActive ? 'Stop access' : 'Allow access'}
                      </Button>
                    </>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Card>
      <Card title="Add a person">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <div className="form-grid">
            <TextField
              label="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <TextField
              label="PIN (4 to 6 digits)"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={form.pin}
              onChange={(e) => setForm({ ...form, pin: e.target.value })}
              hint="They type this to sign in."
            />
            <SelectField
              label="Role"
              value={form.role}
              onChange={(e) =>
                setForm({ ...form, role: e.target.value === 'owner' ? 'owner' : 'staff' })
              }
            >
              <option value="staff">Staff (billing)</option>
              <option value="owner">Owner (everything)</option>
            </SelectField>
          </div>
          <Button variant="primary" type="submit">
            Add person
          </Button>
        </form>
      </Card>
      {pinFor && <PinDialog user={pinFor} onClose={() => setPinFor(null)} />}
      {sure && (
        <ConfirmDialog
          title={`Change what ${sure.user.name} can do?`}
          confirmLabel="Yes, do it"
          cancelLabel="No, leave it"
          onCancel={() => setSure(null)}
          onConfirm={() => {
            const { user, patch } = sure;
            setSure(null);
            update(user.id, patch);
          }}
        >
          <p>{sure.words}</p>
        </ConfirmDialog>
      )}
    </>
  );
}

function PinDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (pin !== again) {
      setError('The two PINs are not the same. Please type them again.');
      return;
    }
    call('users.changePin', { id: user.id, pin }).then(
      () => {
        toast.show(`New PIN saved for ${user.name}.`);
        onClose();
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'The PIN could not be changed.'),
    );
  };
  useHotkeys({ Escape: onClose }, true, true);
  return (
    <div className="overlay">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`New PIN for ${user.name}`}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2>New PIN for {user.name}</h2>
        {error && <Notice>{error}</Notice>}
        <TextField
          label="New PIN (4 to 6 digits)"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
        <TextField
          label="Type it again"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
        />
        <div className="dialog-actions">
          <Button onClick={onClose}>Cancel (Esc)</Button>
          <Button variant="primary" type="submit">
            Save PIN (Enter)
          </Button>
        </div>
      </form>
    </div>
  );
}
