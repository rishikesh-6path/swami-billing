# DECISIONS

One dated paragraph per decision. Newest at the bottom. Dependency additions go here with the reason.

2026-10-01 — Electron 37+ with built-in `node:sqlite` instead of better-sqlite3. Reason: zero native modules, no ABI rebuild step, nothing to compile on the shop PC. Trade-off: slightly different API from better-sqlite3 (DatabaseSync/StatementSync); wrap it once in `packages/core/src/db/connection.ts`.

2026-10-01 — No ORM. Reason: ~25 tables, accounting queries must be auditable as SQL, and ORM migrations fight hand-tuned schemas. Repositories use prepared statements and zod row mappers.

2026-10-01 — Money as integer paise, quantity as integer thousandths. Reason: Busy shows 2-dp money and up to 3-dp quantity (e.g. 127.05 Metre); floats would break golden-file equality.

2026-10-01 — Vouchers are never hard-deleted. Reason: GSTR-1 table 13 requires gap-free document numbering and cancelled counts; audit trail for the CA.

2026-10-01 — Markdown-in-repo tracking (TASKS.md, SESSION_LOG.md) instead of GitHub Issues. Reason: single builder; keeps every Claude Code session free of issue-tracker MCP overhead.

2026-10-01 — UX principle: the users are non-technical shop staff, so every screen uses plain language (no database, schema, IPC or stack-trace wording), large readable text and click targets, and errors that say what happened and what to do next. Technical details (DB path, schema version) live in a collapsed "About this computer" panel. Busy's own terms (Sales, Receipt, Ledger) are kept because staff already know them.
