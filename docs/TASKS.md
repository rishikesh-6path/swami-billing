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
P2-02 | todo | Financial year management, carry-forward, day close rules | unit tests |
P2-03 | todo | Company profile, users, PIN (scrypt), roles, lockout, permissions | unit tests |
P2-04 | todo | Stock Journal, Physical Stock, voucher modify, cash/bank leg checks, credit-note qty check | unit + invariant tests |
P2-05 | todo | Demo data seeder + CSV import for items and parties | unit tests |

## Phase 3 — Friendly desktop UI
P3-01 | todo | IPC contract + handlers + plain-language error mapping | contract tests |
P3-02 | todo | App shell: login, first-run setup, home tiles, global shortcuts, status bar | E2E |
P3-03 | todo | Masters screens (keyboard-only) | E2E create item by keyboard |
P3-04 | todo | Sales bill screen (grid, lookup, sundries, tax preview, settlement) | E2E keyboard-only 5-line bill |
P3-05 | todo | Purchase, returns, receipt, payment, journal, contra, notes, stock journal, physical stock screens | E2E receipt then ledger |
P3-06 | todo | Report screens + exports | E2E |
P3-07 | todo | Voucher list, modify, cancel, audit viewer | E2E cancel verifies reversal |
P3-08 | todo | Print: A4 invoice, 80 mm thermal, PDF | unit tests on HTML; manual printer check |

## Phase 4 — Operations
P4-01 | todo | Backup (VACUUM INTO, schedule, retention, removable drive) + restore with integrity check | unit tests |
P4-02 | todo | Settings screen | E2E |
P4-03 | todo | electron-builder NSIS config, auto-launch, packaged migrations path | config check; Windows run pending |
P4-04 | todo | USER_GUIDE.md and owner runbook | review |

## Waiting on Tony (not blocking)
Review of autonomous decisions in DECISIONS.md; Windows shop-PC checks (printer, installer, power-cut, restore drill); CA review of GST outputs.
