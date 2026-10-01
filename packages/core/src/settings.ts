import type { Db } from './db/connection.ts';
import { ValidationError } from './errors.ts';

export function getSetting(db: Db, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(key);
  return row ? String(row['value']) : undefined;
}

/** The shop's own GST state code. Billing needs it, so a missing value is a setup problem to fix. */
export function getCompanyStateCode(db: Db): string {
  const code = getSetting(db, 'company.state_code');
  if (!code)
    throw new ValidationError("Please enter your shop's state in Settings before billing.");
  return code;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
