# TASKS

Status: todo | doing | done | blocked. One task per Claude Code session. Claude updates this file at the end of every session; Tony reviews the diff before the next session.
Format: `id | status | title | acceptance | closed-in-session`

## Phase 0 — Foundation
P0-01 | done | pnpm workspace, packages/core, apps/desktop, TS strict, eslint+prettier | `pnpm typecheck && pnpm lint` clean on empty project | P0-kickoff
P0-02 | done | Electron 37+ main/preload/renderer with Vite + React 19, single-instance lock | `pnpm dev` opens window | P0-kickoff
P0-03 | done | node:sqlite wrapper in core: open WAL, foreign_keys ON, integrity_check on start | unit test opens :memory: and on-disk temp DB | P0-kickoff
P0-04 | done | Migration runner + schema_version + `pnpm migrate:new` | test applies 0001 and refuses to re-apply | P0-kickoff
P0-05 | done | Typed IPC contract (zod) with one channel `app.info` → renderer shows DB path + schema version | Playwright test reads the text | P0-kickoff
P0-06 | done | Vitest, fast-check, Playwright wired; `.claude/settings.json` hooks active; DECISIONS.md and SESSION_LOG.md seeded | `pnpm test` and `pnpm e2e` pass | P0-kickoff

## Phase 1 — Import and read-only truth
P1-00 | done | Money/quantity helpers + domain schema migration (KICKOFF §6 tables) | unit + fast-check tests, schema applies on :memory: | P0-kickoff
P1-01 | todo | Busy XML streaming parser: masters | sample fixture parses; idempotent re-import |
P1-02 | todo | Busy XML parser: all voucher types; exceptions CSV | every voucher type in sample imported |
P1-03 | done | Posting engine (journal + stock lines) for sales, purchase, returns and entry vouchers; cancel with reversal (Stock Journal and Physical Stock are P3-04) | fast-check invariants §6, 500 runs (also passed at 5,000) | P0-kickoff
P1-04 | todo | Account Ledger report + golden-file harness | ledger_ayappan.csv matches |
P1-05 | todo | Stock Status + Item Ledger reports | stock_status.csv matches |
P1-06 | todo | Trial Balance + Day Book | trial_balance.csv matches |
P1-07 | todo | GST Summary report | busy_gst_summary fixture matches every cell |
P1-08 | todo | docs/reconciliation.md with all remaining differences explained | CA-readable |

## Phase 2 — Counter
P2-01 | todo | Item group + item masters CRUD, alias search (§7 lookup rules) | E2E: create item by keyboard only |
P2-02 | todo | Account group + account/party masters CRUD | unit tests |
P2-03 | todo | Sale types, voucher series, bill sundries, brokers masters | unit tests |
P2-04 | todo | Sales voucher screen: grid, keys per §7, tax table, sundries, settlement | E2E keyboard-only bill |
P2-05 | todo | Receipt voucher screen | E2E receipt then ledger check |
P2-06 | todo | Print: A4 invoice + 80 mm thermal templates, printer setting | CA field review |
P2-07 | todo | Party dashboard (balance, last 5 bills, outstanding) | manual |
P2-08 | todo | `pnpm recon` daily reconciliation script vs Busy export | runs on shop PC |
P2-09 | todo | Timed acceptance: 5-line bill < 25 s by staff | logged in reconciliation.md |

## Phase 3 — Full books
P3-01 | todo | Purchase + Purchase Return vouchers |
P3-02 | todo | Sales Return (Cr Note) with original invoice reference |
P3-03 | todo | Payment, Journal, Contra, Dr/Cr Note w/o items |
P3-04 | todo | Stock Journal + Physical Stock |
P3-05 | todo | Voucher modify/cancel with reversal + audit log |
P3-06 | todo | Outstanding report, Sales/Purchase registers |
P3-07 | todo | One full shadow month reconciles with zero unexplained differences |

## Phase 4 — Statutory
P4-01 | todo | P&L and Balance Sheet |
P4-02 | todo | GSTR-1 tables 7, 4, 12, 13 as CSV (offline tool headers) + PDF |
P4-03 | todo | GSTR-3B table 3.1 and 4 |
P4-04 | todo | CA sign-off recorded |

## Phase 5 — Operations and cutover
P5-01 | todo | Users, PIN (argon2id), roles, day close |
P5-02 | todo | Backup (VACUUM INTO, schedule, removable drive) + restore with integrity check |
P5-03 | todo | Change financial year with carry-forward |
P5-04 | todo | electron-builder NSIS installer, auto-launch, printer settings |
P5-05 | todo | Power-cut test and restore drill on shop PC |
P5-06 | todo | Cutover 01-04-2027 |

## Blocked / waiting on Tony
OQ-1..OQ-7 in KICKOFF §14 — answers needed before P1 planning session.
