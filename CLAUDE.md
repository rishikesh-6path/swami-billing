# ShopLedger — Busy 17 replacement for a hardware/electrical/plumbing shop

Offline desktop billing + double-entry accounting for ONE Windows PC. Replaces Busy 17 (Rel 9.11).
Full spec, phases and acceptance criteria: @docs/KICKOFF.md. Current work: @docs/TASKS.md.
Read both before planning anything. Do not re-derive architecture that KICKOFF.md already fixes.

## Stack (fixed — do not substitute)
- TypeScript strict everywhere. pnpm workspace. Node 24+.
- `packages/core`  pure TS: domain logic, SQLite access, migrations, Busy XML import. No Electron imports.
- `apps/desktop`   Electron 37+ (ships Node 24 → use built-in `node:sqlite`, zero native modules). React 19 + Vite renderer.
- SQLite single file, WAL mode, `foreign_keys=ON`. Hand-written numbered SQL migrations in `packages/core/migrations/NNNN_*.sql`.
- Renderer never touches SQL. All data goes through typed IPC in `apps/desktop/src/ipc/` validated with zod.
- Tests: Vitest (core, in-memory SQLite), fast-check for ledger invariants, Playwright for Electron E2E.
- Packaging: electron-builder NSIS, per-machine, single-instance lock, auto-launch on login.

## Commands
- `pnpm i`                      install
- `pnpm dev`                    run desktop app with hot reload
- `pnpm test`                   all Vitest (core)
- `pnpm test:core -- <pattern>` one test file — prefer this over the full suite
- `pnpm e2e`                    Playwright Electron tests (slow; run before marking a phase done)
- `pnpm typecheck`              `tsc --noEmit` across workspace — must pass before any commit
- `pnpm lint`                   eslint + prettier check
- `pnpm migrate:new <name>`     scaffold next migration file
- `pnpm import:busy <dir>`      import Busy XML export directory into a fresh DB
- `pnpm build:win`              produce installer in `dist/`

## Hard rules
- Money is INTEGER paise. Quantity is INTEGER thousandths (3 dp). Never use JS floats for either. Format only at the UI edge.
- Every voucher posts balanced journal lines in the SAME transaction as the voucher insert. A voucher whose debits != credits must throw and roll back. Test this.
- Vouchers are never hard-deleted. Cancel = status `cancelled` + reversal lines. Audit log row on every create/modify/cancel.
- Never edit an applied migration file. Add a new one. Migrations run inside a transaction with a `schema_version` check.
- Dates are ISO `YYYY-MM-DD` strings in Asia/Kolkata. Financial year = 1 April to 31 March.
- Voucher numbering is per (voucher_type, series, financial_year), gap-free, assigned inside the insert transaction.
- Keyboard first. Every entry screen must be fully operable without a mouse. Shortcut map is in KICKOFF.md §7 and must not drift.
- Do not add dependencies without listing why in `docs/DECISIONS.md`. No ORM. No state library until there is a measured need.
- No network calls at runtime. The app must work with the network cable unplugged.

## Workflow
- Start every non-trivial task in plan mode. Plan → approve → implement → run `pnpm typecheck` + the relevant tests → commit.
- One task from TASKS.md per session. `/clear` between unrelated tasks.
- Commit format: `type(scope): summary` e.g. `feat(core): sales voucher posting`. Reference the TASKS.md id.
- Before saying a task is done: show the test output and the command that produced it. Update TASKS.md status and add a line to `docs/SESSION_LOG.md` with the `/usage` cost.
- When you learn a non-obvious gotcha, add ONE line to `docs/DECISIONS.md`, not to this file.

## Compact instructions
When compacting, always preserve: the list of modified files, failing test names, the current TASKS.md id, and any open question for the user.
