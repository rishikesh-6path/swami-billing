import { describe, expect, it } from 'vitest';
import { listFinancialYears } from '../../src/books/financial-year.ts';
import { ValidationError } from '../../src/errors.ts';
import { listVoucherSeries } from '../../src/masters/setup.ts';
import { getCompany, saveCompany } from '../../src/users/company.ts';
import { can } from '../../src/users/permissions.ts';
import { completeSetup, isSetupComplete } from '../../src/users/setup.ts';
import {
  changePin,
  createUser,
  getUser,
  hashPin,
  listUsers,
  login,
  pinMatches,
  updateUser,
} from '../../src/users/users.ts';
import { freshDb } from '../helpers/db.ts';

const COMPANY = {
  name: 'Swami Hardware',
  address: '12 Main Road, Kuttalam',
  stateCode: '33',
  phone: '98400 12345',
};

describe('PIN hashing', () => {
  it('uses a random salt and verifies only the right PIN', () => {
    const a = hashPin('1234');
    const b = hashPin('1234');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(pinMatches('1234', a)).toBe(true);
    expect(pinMatches('1235', a)).toBe(false);
    expect(pinMatches('1234', 'garbage')).toBe(false);
  });
});

describe('company', () => {
  it('saves and reads the shop profile, with a validated GSTIN', () => {
    const db = freshDb();
    expect(getCompany(db)).toBeUndefined();
    saveCompany(db, { ...COMPANY, gstin: '33aapfu0939f1z2' });
    expect(getCompany(db)).toMatchObject({
      name: 'Swami Hardware',
      stateCode: '33',
      gstin: '33AAPFU0939F1Z2',
      phone: '9840012345',
    });
    expect(() =>
      saveCompany(db, { ...COMPANY, gstin: '33AAPFU0939F1Z2', stateCode: '29' }),
    ).toThrow(/state does not match/);
    expect(() => saveCompany(db, { name: 'X' })).toThrow(/choose your shop's state/);
    expect(() => saveCompany(db, { name: ' ', stateCode: '33' })).toThrow(/shop name/);
  });
});

describe('users and sign-in', () => {
  function shop() {
    const db = freshDb();
    createUser(db, { name: 'Tony', pin: '4821', role: 'owner' });
    createUser(db, { name: 'Murugan', pin: '1357', role: 'staff' });
    return db;
  }

  it('signs in by name (any case) and PIN, and never reveals which one was wrong', () => {
    const db = shop();
    expect(login(db, 'tony', '4821')).toMatchObject({ name: 'Tony', role: 'owner' });
    expect(() => login(db, 'Tony', '0000')).toThrow(
      'The name or PIN is not right. Please try again.',
    );
    expect(() => login(db, 'Nobody', '4821')).toThrow(
      'The name or PIN is not right. Please try again.',
    );
  });

  it('validates names and PINs in plain words', () => {
    const db = shop();
    expect(() => createUser(db, { name: 'Ravi', pin: '12', role: 'staff' })).toThrow(
      /4 to 6 digits/,
    );
    expect(() => createUser(db, { name: 'Ravi', pin: 'abcd', role: 'staff' })).toThrow(
      ValidationError,
    );
    expect(() => createUser(db, { name: 'TONY', pin: '4829', role: 'staff' })).toThrow(
      /already a user/,
    );
  });

  it('locks an account for five minutes after five wrong PINs, then allows sign-in again', () => {
    const db = shop();
    const t = (minutes: number) => ({
      now: new Date(Date.UTC(2026, 9, 1, 10, minutes)).toISOString(),
    });
    for (let i = 0; i < 5; i++)
      expect(() => login(db, 'Murugan', '0000', t(0))).toThrow(/not right/);
    expect(() => login(db, 'Murugan', '1357', t(1))).toThrow(/Too many wrong PINs/);
    expect(login(db, 'Murugan', '1357', t(6)).name).toBe('Murugan');
  });

  it('resets the failure count after a good sign-in', () => {
    const db = shop();
    for (let i = 0; i < 4; i++) expect(() => login(db, 'Murugan', '0000')).toThrow();
    login(db, 'Murugan', '1357');
    for (let i = 0; i < 4; i++) expect(() => login(db, 'Murugan', '0000')).toThrow(/not right/);
    expect(login(db, 'Murugan', '1357').name).toBe('Murugan');
  });

  it('changes a PIN and blocks sign-in for inactive users', () => {
    const db = shop();
    const staff = listUsers(db).find((u) => u.name === 'Murugan')!;
    changePin(db, staff.id, '9273');
    expect(() => login(db, 'Murugan', '1357')).toThrow();
    expect(login(db, 'Murugan', '9273').id).toBe(staff.id);
    updateUser(db, staff.id, { isActive: false });
    expect(() => login(db, 'Murugan', '9273')).toThrow(/not right/);
  });

  it('always keeps at least one owner who can sign in', () => {
    const db = shop();
    const owner = listUsers(db).find((u) => u.role === 'owner')!;
    expect(() => updateUser(db, owner.id, { isActive: false })).toThrow(/at least one owner/);
    expect(() => updateUser(db, owner.id, { role: 'staff' })).toThrow(/at least one owner/);
    const second = createUser(db, { name: 'Partner', pin: '2468', role: 'owner' });
    updateUser(db, owner.id, { role: 'staff' });
    expect(getUser(db, owner.id)!.role).toBe('staff');
    expect(getUser(db, second)!.role).toBe('owner');
  });
});

describe('permissions', () => {
  it('lets staff bill and see daily reports but not profit, GST or settings', () => {
    expect(can('staff', 'bill')).toBe(true);
    expect(can('staff', 'cancel_voucher')).toBe(true);
    expect(can('staff', 'view_daily_reports')).toBe(true);
    for (const action of [
      'view_profit_and_loss',
      'view_balance_sheet',
      'view_gst',
      'close_day',
      'lock_books',
      'manage_users',
      'manage_settings',
      'backup_restore',
      'view_audit_log',
      'close_year',
    ] as const) {
      expect(can('staff', action)).toBe(false);
      expect(can('owner', action)).toBe(true);
    }
  });
});

describe('first-run setup', () => {
  it('creates the shop, owner, financial year and standard masters in one step', () => {
    const db = freshDb();
    expect(isSetupComplete(db)).toBe(false);
    const ownerId = completeSetup(db, {
      company: COMPANY,
      ownerName: 'Tony',
      ownerPin: '4821',
      today: '2026-10-01',
    });
    expect(isSetupComplete(db)).toBe(true);
    expect(getUser(db, ownerId)!.role).toBe('owner');
    expect(listFinancialYears(db).map((y) => y.label)).toEqual(['2026-27']);
    expect(listVoucherSeries(db, 'sales')).toHaveLength(1);
    expect(login(db, 'Tony', '4821').id).toBe(ownerId);
  });

  it('cannot run twice and leaves nothing behind when it fails', () => {
    const db = freshDb();
    expect(() =>
      completeSetup(db, {
        company: { name: 'X' },
        ownerName: 'Tony',
        ownerPin: '4821',
        today: '2026-10-01',
      }),
    ).toThrow();
    expect(listUsers(db)).toEqual([]);
    completeSetup(db, {
      company: COMPANY,
      ownerName: 'Tony',
      ownerPin: '4821',
      today: '2026-10-01',
    });
    expect(() =>
      completeSetup(db, {
        company: COMPANY,
        ownerName: 'Other',
        ownerPin: '1111',
        today: '2026-10-01',
      }),
    ).toThrow(/already been set up/);
  });
});
