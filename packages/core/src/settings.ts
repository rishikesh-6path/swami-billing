import type { Db } from './db/connection.ts';

export function getSetting(db: Db, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM setting WHERE key = ?').get(key);
  return row ? String(row['value']) : undefined;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare(
    'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
