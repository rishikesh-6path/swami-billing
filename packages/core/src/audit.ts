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

export interface AuditRow {
  id: number;
  at: string;
  userName: string | null;
  action: string;
  tableName: string;
  rowId: number;
  /** A short plain description of what the entry is about, for the audit screen. */
  description: string;
  /** The reason given when a bill was cancelled. */
  reason: string | null;
}

/** Recent audit entries, newest first, for the owner's audit screen. `text` matches the user, action or description. */
export function listAudit(
  db: Db,
  args: {
    from?: string | undefined;
    to?: string | undefined;
    text?: string | undefined;
    limit?: number | undefined;
  } = {},
): AuditRow[] {
  const like = `%${(args.text ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db
    .prepare(
      `SELECT * FROM (
         SELECT a.id, a.at, u.name AS user_name, a.action, a.table_name, a.row_id,
                CASE WHEN a.table_name = 'voucher' AND v.id IS NOT NULL
                       THEN replace(v.voucher_type, '_', ' ') || ' ' || s.prefix || v.number || ' on ' || v.date
                     WHEN json_valid(a.after_json) AND json_extract(a.after_json, '$.name') IS NOT NULL
                       THEN a.table_name || ' ' || json_extract(a.after_json, '$.name')
                     WHEN a.table_name = 'setting' THEN 'settings'
                     ELSE CASE a.table_name
                            WHEN 'account' THEN 'customer, supplier or account'
                            WHEN 'financial_year' THEN 'financial year'
                            WHEN 'user' THEN 'person'
                            ELSE a.table_name END || ' ' || a.row_id END AS description,
                CASE WHEN a.action = 'cancel' AND json_valid(a.after_json)
                       THEN json_extract(a.after_json, '$.cancelReason') END AS reason
         FROM audit_log a
         LEFT JOIN user u ON u.id = a.user_id
         LEFT JOIN voucher v ON a.table_name = 'voucher' AND v.id = a.row_id
         LEFT JOIN voucher_series s ON s.id = v.series_id
         -- the log stores UTC; the shop's days are Indian days (UTC+5:30)
         WHERE (? IS NULL OR COALESCE(date(a.at, '+330 minutes'), substr(a.at, 1, 10)) >= ?)
           AND (? IS NULL OR COALESCE(date(a.at, '+330 minutes'), substr(a.at, 1, 10)) <= ?)
       )
       WHERE (? = '%%' OR lower(COALESCE(user_name, '')) LIKE ? ESCAPE '\\' OR lower(action) LIKE ? ESCAPE '\\'
              OR lower(description) LIKE ? ESCAPE '\\')
       ORDER BY id DESC LIMIT ?`,
    )
    .all(
      args.from ?? null,
      args.from ?? null,
      args.to ?? null,
      args.to ?? null,
      like,
      like,
      like,
      like,
      args.limit ?? 300,
    )
    .map((r) => ({
      id: Number(r['id']),
      at: String(r['at']),
      userName: r['user_name'] === null ? null : String(r['user_name']),
      action: String(r['action']),
      tableName: String(r['table_name']),
      rowId: Number(r['row_id']),
      description: String(r['description']),
      reason: r['reason'] === null || r['reason'] === undefined ? null : String(r['reason']),
    }));
}
