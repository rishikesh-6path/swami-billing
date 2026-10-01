import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/db/connection.ts';
import {
  applyMigration,
  currentSchemaVersion,
  loadMigrationsFromDir,
  migrate,
} from '../../src/db/migrations.ts';
import { MIGRATIONS_DIR } from '../helpers/db.ts';
import { tempDir } from '../helpers/tmp.ts';

function migrationDir(files: Record<string, string>): string {
  const dir = tempDir();
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

describe('migrations', () => {
  it('applies 0001 and records it in schema_version', () => {
    const db = openDatabase(':memory:');
    const applied = migrate(db, loadMigrationsFromDir(MIGRATIONS_DIR));
    expect(applied).toEqual([1]);
    expect(currentSchemaVersion(db)).toBe(1);
    expect(db.prepare('SELECT name FROM schema_version WHERE version = 1').get()).toEqual({
      name: 'init',
    });
    db.exec("INSERT INTO setting (key, value) VALUES ('a', 'b')");
  });

  it('refuses to re-apply an applied migration', () => {
    const db = openDatabase(':memory:');
    const migrations = loadMigrationsFromDir(MIGRATIONS_DIR);
    migrate(db, migrations);
    expect(migrate(db, migrations)).toEqual([]);
    expect(() => applyMigration(db, migrations[0]!)).toThrow(/already applied/);
  });

  it('refuses to run when an applied migration file was edited', () => {
    const db = openDatabase(':memory:');
    const dir = migrationDir({ '0001_a.sql': 'CREATE TABLE a (id INTEGER) STRICT;' });
    migrate(db, loadMigrationsFromDir(dir));
    writeFileSync(join(dir, '0001_a.sql'), 'CREATE TABLE a (id INTEGER, extra TEXT) STRICT;');
    expect(() => migrate(db, loadMigrationsFromDir(dir))).toThrow(/edited after it was applied/);
  });

  it('refuses a database created by a newer version of the app', () => {
    const db = openDatabase(':memory:');
    const dir = migrationDir({
      '0001_a.sql': 'CREATE TABLE a (id INTEGER) STRICT;',
      '0002_b.sql': 'CREATE TABLE b (id INTEGER) STRICT;',
    });
    migrate(db, loadMigrationsFromDir(dir));
    const older = migrationDir({ '0001_a.sql': 'CREATE TABLE a (id INTEGER) STRICT;' });
    expect(() => migrate(db, loadMigrationsFromDir(older))).toThrow(/newer version/);
  });

  it('rejects a gap in migration numbering', () => {
    const dir = migrationDir({ '0001_a.sql': 'SELECT 1;', '0003_c.sql': 'SELECT 1;' });
    expect(() => loadMigrationsFromDir(dir)).toThrow(/without gaps/);
  });

  it('rejects a misnamed migration file', () => {
    const dir = migrationDir({ 'add-items.sql': 'SELECT 1;' });
    expect(() => loadMigrationsFromDir(dir)).toThrow(/NNNN_name\.sql/);
  });

  it('leaves schema_version and the schema unchanged when a migration fails', () => {
    const db = openDatabase(':memory:');
    const dir = migrationDir({
      '0001_a.sql': 'CREATE TABLE a (id INTEGER) STRICT;',
      '0002_bad.sql': 'CREATE TABLE b (id INTEGER) STRICT; INSERT INTO missing_table VALUES (1);',
    });
    expect(() => migrate(db, loadMigrationsFromDir(dir))).toThrow();
    expect(currentSchemaVersion(db)).toBe(1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").all();
    expect(tables).toEqual([]);
  });
});
