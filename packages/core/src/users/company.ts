import { writeAudit, type Ctx } from '../audit.ts';
import { transaction, type Db } from '../db/connection.ts';
import { ValidationError } from '../errors.ts';
import { cleanParty, requireName } from '../masters/validation.ts';
import { getSetting, setSetting } from '../settings.ts';

export interface Company {
  name: string;
  address: string;
  gstin: string | null;
  stateCode: string;
  phone: string | null;
  /** Printed at the bottom of invoices, e.g. terms or a thank-you line. */
  invoiceFooter: string;
}

const KEYS = {
  name: 'company.name',
  address: 'company.address',
  gstin: 'company.gstin',
  stateCode: 'company.state_code',
  phone: 'company.phone',
  invoiceFooter: 'company.invoice_footer',
} as const;

export function getCompany(db: Db): Company | undefined {
  const name = getSetting(db, KEYS.name);
  const stateCode = getSetting(db, KEYS.stateCode);
  if (!name || !stateCode) return undefined;
  return {
    name,
    address: getSetting(db, KEYS.address) ?? '',
    gstin: getSetting(db, KEYS.gstin) || null,
    stateCode,
    phone: getSetting(db, KEYS.phone) || null,
    invoiceFooter: getSetting(db, KEYS.invoiceFooter) ?? '',
  };
}

export interface CompanyInput {
  name: string;
  address?: string | undefined;
  gstin?: string | null | undefined;
  stateCode?: string | null | undefined;
  phone?: string | null | undefined;
  invoiceFooter?: string | undefined;
}

export function saveCompany(db: Db, input: CompanyInput, ctx: Ctx = {}): Company {
  const name = requireName(input.name, 'shop name');
  const party = cleanParty(input);
  if (!party.stateCode) throw new ValidationError("Please choose your shop's state.");
  transaction(db, () => {
    const before = getCompany(db);
    setSetting(db, KEYS.name, name);
    setSetting(db, KEYS.address, (input.address ?? '').trim());
    setSetting(db, KEYS.gstin, party.gstin ?? '');
    setSetting(db, KEYS.stateCode, party.stateCode!);
    setSetting(db, KEYS.phone, party.phone ?? '');
    setSetting(db, KEYS.invoiceFooter, (input.invoiceFooter ?? '').trim());
    writeAudit(db, ctx, {
      action: 'save_company',
      table: 'setting',
      rowId: 0,
      before,
      after: getCompany(db),
    });
  });
  return getCompany(db)!;
}
