// Scaffolds the next numbered migration: pnpm migrate:new <name>
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'packages', 'core', 'migrations');
const raw = process.argv.slice(2).join(' ').trim();
const name = raw
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

if (!name) {
  console.error('Usage: pnpm migrate:new <name>   e.g. pnpm migrate:new add_items');
  process.exit(1);
}

const numbers = readdirSync(dir)
  .map((file) => /^(\d{4})_/.exec(file)?.[1])
  .filter(Boolean)
  .map(Number);
const next = String(Math.max(0, ...numbers) + 1).padStart(4, '0');
const path = join(dir, `${next}_${name}.sql`);

if (existsSync(path)) {
  console.error(`Refusing to overwrite ${path}`);
  process.exit(1);
}

writeFileSync(
  path,
  `-- ${next}_${name}\n-- Never edit this file once applied; add a new migration instead.\n`,
);
console.log(`Created packages/core/migrations/${next}_${name}.sql`);
