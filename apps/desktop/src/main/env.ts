import { app } from 'electron';

/**
 * Settings that exist only for development and automated tests (a pinned date, a temporary
 * database, a sample shop). A packaged shop copy ignores them unless SHOPLEDGER_E2E=1 is also
 * set, so a stray variable on the shop PC can never change business dates or point the app at
 * another data file.
 */
export function testKnob(name: string): string | undefined {
  const allowed = !app.isPackaged || process.env['SHOPLEDGER_E2E'] === '1';
  return allowed ? process.env[name] : undefined;
}
