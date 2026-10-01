import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LATEST_SCHEMA_VERSION } from '../src/db/migrations.ts';
import { MIGRATIONS_DIR } from './helpers/db.ts';

describe('LATEST_SCHEMA_VERSION', () => {
  it('matches the number of migration files (bump it when adding a migration)', () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f));
    expect(LATEST_SCHEMA_VERSION).toBe(files.length);
  });
});
