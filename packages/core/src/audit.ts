import type { Db } from './db/connection.ts';

export interface Ctx {
  userId?: number | undefined;
  now?: string | undefined;
}

export const nowOf = (ctx: Ctx): string => ctx.now ?? new Date().toISOString();

/** Appends one audit row. Callers run this inside the same transaction as the change. */
export function writeAudit(
  db: Db,
  ctx: Ctx,
  entry: { action: string; table: string; rowId: number; before?: unknown; after?: unknown },
): void {
  db.prepare(
    'INSERT INTO audit_log (at, user_id, action, table_name, row_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    nowOf(ctx),
    ctx.userId ?? null,
    entry.action,
    entry.table,
    entry.rowId,
    entry.before === undefined ? null : JSON.stringify(entry.before),
    entry.after === undefined ? null : JSON.stringify(entry.after),
  );
}
