import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

const dirs: string[] = [];

/** Creates a temp directory that is removed after each test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'shopledger-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
