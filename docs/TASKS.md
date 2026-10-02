# TASKS

Status: todo | doing | done | blocked | dropped. Format: `id | status | title | acceptance | closed-in-session`
Scope note (2026-10-01): ShopLedger is a standalone system; Busy is reference only. Busy import, Busy golden files, reconciliation and shadow mode are dropped. See DECISIONS.md.

## Phase 0 — Foundation
P0-01 | done | pnpm workspace, packages/core, apps/desktop, TS strict, eslint+prettier | `pnpm typecheck && pnpm lint` clean | P0-kickoff
P0-02 | done | Electron main/preload/renderer with Vite + React 19, single-instance lock | `pnpm dev` opens window | P0-kickoff
P0-03 | done | node:sqlite wrapper in core: WAL, foreign_keys ON, integrity_check on start | unit tests | P0-kickoff
P0-04 | done | Migration runner + schema_version + `pnpm migrate:new` | unit tests | P0-kickoff
P0-05 | done | Typed IPC contract (zod), `app.info` | Playwright reads the text | P0-kickoff
P0-06 | done | Vitest, fast-check, Playwright wired; hooks active | `pnpm test` and `pnpm e2e` pass | P0-kickoff

## Phase 1 — Core domain and reports
P1-00 | done | Money/quantity helpers + domain schema | unit + property tests | P0-kickoff
P1-01 | dropped | Busy XML importer (masters) | standalone system | -
P1-02 | dropped | Busy XML importer (vouchers) | standalone system | -
P1-03 | done | Posting engine: sales, purchase, returns, entry vouchers, cancel with reversal | invariants §6 at 5,000 runs | P0-kickoff
P1-04 | done | Account Ledger report | unit tests | P0-kickoff
P1-05 | done | Stock Status + Item Ledger | unit + invariant tests | P0-kickoff
P1-06 | done | Trial Balance, Day Book, Day Summary, Outstanding, Sales/Purchase registers | unit + invariant tests | P0-kickoff
P1-07 | done | GST Summary, GSTR-1 (tables 4, 7, 12, 13), GSTR-3B (3.1, 4) as CSV | unit tests, reviewer pass | P0-kickoff
P1-08 | dropped | Busy reconciliation document | standalone system | -
P1-09 | done | P&L and Balance Sheet | balance sheet balances (property test) | P0-kickoff
## Phase 2 — Masters, users, remaining vouchers (core)
P2-01 | done | Masters CRUD with audit + alias-first item search | unit tests | P0-kickoff
P2-02 | done | Financial year management, carry-forward, day close rules | unit tests | P0-kickoff
P2-03 | done | Company profile, users, PIN (scrypt), roles, lockout, permissions | unit tests | P0-kickoff
P2-04 | done | Stock Journal, Physical Stock, voucher modify, cash/bank leg checks, credit-note qty check | unit + invariant tests | P0-kickoff
P2-05 | done | Demo data seeder + CSV import for items and parties | unit tests | P0-kickoff

## Phase 3 — Friendly desktop UI
P3-01 | done | IPC contract + handlers + plain-language error mapping | contract tests | P0-kickoff
P3-02 | done | App shell: login, first-run setup, home tiles, global shortcuts, status bar | E2E | P0-kickoff
P3-03 | done | Masters screens (keyboard-only) | E2E create item by keyboard | P0-kickoff
P3-04 | done | Sales bill screen (grid, lookup, sundries, tax preview, settlement) | E2E keyboard-only 5-line bill | P0-kickoff
P3-05 | done | Purchase, returns, receipt, payment, journal, contra, notes, stock journal, physical stock screens | E2E receipt then ledger | P0-kickoff
P3-06 | done | Report screens + exports | E2E | P0-kickoff
P3-07 | done | Voucher list, modify, cancel, audit viewer | E2E cancel verifies reversal | P0-kickoff
P3-08 | done | Print: A4 invoice, 80 mm thermal, PDF | unit tests on HTML; E2E preview and PDF; manual printer check pending | P0-kickoff

## Phase 4 — Operations
P4-01 | done | Backup (VACUUM INTO, schedule, retention, removable drive) + restore with integrity check | unit tests + E2E; real drive and restore drill on the shop PC pending | P0-kickoff
P4-02 | done | Settings screen (shop, printing, people, day close, books lock, year close, backup) | E2E | P0-kickoff
P4-03 | done | electron-builder NSIS config, auto-launch, packaged migrations path | packaged folder smoke-tested on Linux (E2E, SHOPLEDGER_PACKAGED_EXE); installer build and run on Windows pending | P0-kickoff
P4-04 | done | USER_GUIDE.md and owner runbook, keymap | review by owner | P0-kickoff

## Phase 5 — Gaps found after the first build
P5-01 | done | Supplier invoice number and date on purchases (required for GST suppliers, duplicate check) | unit + E2E | P0-kickoff
P5-02 | done | Credit Note and Debit Note that reach the GST returns | unit, property, E2E, reviewer pass | P0-kickoff
P5-03 | done | Customer and supplier summary screen | unit + E2E | P0-kickoff
P5-04 | done | Backup off the main thread, partial day reopen, dialog focus, faster import | unit + E2E, packaged-build check | P0-kickoff

## Waiting on Tony (not blocking)
Review of autonomous decisions in DECISIONS.md; Windows shop-PC checks (printer, installer, power-cut, restore drill); CA review of GST outputs.
