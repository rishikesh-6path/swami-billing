import { useState } from 'react';
import type { Company } from '@shopledger/core';
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
import { useHotkeys } from '../../lib/hotkeys.tsx';

export function ShopSection({ onSession }: { onSession: (s: SessionState) => void }) {
  const settings = useCall('settings.get', {});
  return (
    <LoadState state={settings}>
      {settings.status === 'ready' && settings.data.company && (
        <ShopForm company={settings.data.company} onSession={onSession} />
      )}
    </LoadState>
  );
}

function ShopForm({
  company,
  onSession,
}: {
  company: Company;
  onSession: (s: SessionState) => void;
}) {
  const toast = useToast();
  const states = useCall('lookup.states', {});
  const [form, setForm] = useState({
    name: company.name,
    address: company.address,
    stateCode: company.stateCode,
    gstin: company.gstin ?? '',
    phone: company.phone ?? '',
    invoiceFooter: company.invoiceFooter,
  });
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = () => {
    setError(null);
    call('settings.saveCompany', form).then(
      () => {
        toast.show('Shop details saved.');
        void call('session.state', {}).then(onSession);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : 'The details could not be saved.'),
    );
  };
  useHotkeys({ F2: save });

  return (
    <Card title="Shop details">
      <p className="muted">These are printed on every bill.</p>
      {error && <Notice>{error}</Notice>}
      <div className="form-grid">
        <TextField label="Shop name" value={form.name} onChange={set('name')} autoFocus />
        <TextField label="Address" value={form.address} onChange={set('address')} />
        <SelectField
          label="State"
          value={form.stateCode}
          onChange={set('stateCode')}
          hint="Used to work out CGST, SGST or IGST."
        >
          {states.status === 'ready' &&
            states.data.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
        </SelectField>
        <TextField
          label="GST number (GSTIN)"
          value={form.gstin}
          onChange={set('gstin')}
          hint="Leave empty if the shop is not registered for GST."
        />
        <TextField label="Phone" value={form.phone} onChange={set('phone')} />
        <TextField
          label="Line at the bottom of bills"
          value={form.invoiceFooter}
          onChange={set('invoiceFooter')}
          hint="For example: Thank you. Goods once sold will not be taken back."
        />
      </div>
      <Button variant="primary" onClick={save}>
        Save (F2)
      </Button>
    </Card>
  );
}
