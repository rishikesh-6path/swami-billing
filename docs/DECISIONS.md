# DECISIONS

One dated paragraph per decision. Newest at the bottom. Dependency additions go here with the reason.

2026-10-01 — Electron 37+ with built-in `node:sqlite` instead of better-sqlite3. Reason: zero native modules, no ABI rebuild step, nothing to compile on the shop PC. Trade-off: slightly different API from better-sqlite3 (DatabaseSync/StatementSync); wrap it once in `packages/core/src/db/connection.ts`.

2026-10-01 — No ORM. Reason: ~25 tables, accounting queries must be auditable as SQL, and ORM migrations fight hand-tuned schemas. Repositories use prepared statements and zod row mappers.

2026-10-01 — Money as integer paise, quantity as integer thousandths. Reason: Busy shows 2-dp money and up to 3-dp quantity (e.g. 127.05 Metre); floats would break golden-file equality.

2026-10-01 — Vouchers are never hard-deleted. Reason: GSTR-1 table 13 requires gap-free document numbering and cancelled counts; audit trail for the CA.

2026-10-01 — Markdown-in-repo tracking (TASKS.md, SESSION_LOG.md) instead of GitHub Issues. Reason: single builder; keeps every Claude Code session free of issue-tracker MCP overhead.

2026-10-01 — UX principle: the users are non-technical shop staff, so every screen uses plain language (no database, schema, IPC or stack-trace wording), large readable text and click targets, and errors that say what happened and what to do next. Technical details (DB path, schema version) live in a collapsed "About this computer" panel. Busy's own terms (Sales, Receipt, Ledger) are kept because staff already know them.

2026-10-01 — Electron version correction: Electron 37 bundles Node 22.16, not Node 24 (Node 24 starts at Electron 40). Pinned `electron@^44` (Node 24.18) so the runtime matches the "Node 24" assumption. `node:sqlite` is available in both. Tooling (tests, scripts) only needs Node >=22.13 (`engines`), which is what the cloud container has.

2026-10-01 — electron-vite for building main/preload/renderer: one config, HMR, ESM main. Constraints: `@shopledger/core` (TypeScript source) must be bundled, not externalized; preload must be CJS (`.cjs`) and bundle zod because a sandboxed preload cannot require node_modules. Vite pinned to 7 (electron-vite 5 peer range), `@vitejs/plugin-react` 5, TypeScript ~6.0 (typescript-eslint supports <6.1), `@types/node` 22.

2026-10-01 — pnpm 10 skips dependency install scripts: `onlyBuiltDependencies: [electron, esbuild]` is set. If `apps/desktop/node_modules/electron/dist` is missing after `pnpm i`, run `node apps/desktop/node_modules/electron/install.js`.

2026-10-01 — SQLite pragmas: WAL, foreign_keys=ON, `synchronous=FULL` (not NORMAL) so a power cut cannot lose a committed bill (KICKOFF success criterion 3), busy_timeout 5000. Integrity check on every open; failure shows a plain-language dialog and quits without touching the file.

2026-10-01 — Migrations are loaded from a directory passed in by the caller, never via bundler globs, so `packages/core` stays plain-Node. Each migration records a sha256 checksum; editing an applied file or opening a database newer than the app is an error. Packaged location (`process.resourcesPath/migrations`) is wired in P5-04.

2026-10-01 — Dependencies added in Phase 0, with reason: typescript, eslint + @eslint/js + typescript-eslint + eslint-plugin-react-hooks + globals (lint incl. architecture rules: no Electron in core, no Node/core in renderer), prettier (formatting hook), vitest (core tests), fast-check (ledger invariants, KICKOFF section 10), @playwright/test (Electron E2E), electron, electron-vite, vite, @vitejs/plugin-react, react, react-dom (UI), zod (IPC validation), @types/node, @types/react, @types/react-dom.

2026-10-01 — Linux/CI gotcha: running Electron as root needs `--no-sandbox` (E2E passes it when uid is 0; for `pnpm dev` set `ELECTRON_DISABLE_SANDBOX=1`), and a headless box needs a virtual display (`pnpm e2e` wraps in `xvfb-run` when DISPLAY is unset).
