# ShopLedger — Project Kickoff

Version 1.0 — 1 October 2026
Owner: Tony. Builder: Claude Code. Budget: USD 250 of Claude usage. Target cutover: 1 April 2027 (FY 2027-28).

This is the single source of truth for scope, architecture and sequencing. CLAUDE.md points here. If something in this file is wrong, change the file first, then the code.

---

## 1. Outcome

Replace Busy 17 Rel 9.11 on the shop's single Windows PC with a purpose-built offline application that does everything the shop actually uses, produces the same numbers Busy produces for the same data, and is faster to operate at the counter.

Success is measured, not felt:

1. One full month entered in both systems; every party ledger closing balance, stock-status quantity and GST summary figure matches Busy to the paisa.
2. A cash sale with 5 line items can be entered and printed in under 25 seconds by the existing staff without touching the mouse.
3. The app survives power loss mid-entry with no data corruption (SQLite WAL + transactions) and restores from the previous day's backup in under 5 minutes.

---

## 2. What the shop uses in Busy today (observed from screenshots, 1–2 Sept 2026)

| Area | Observed | Implication |
| --- | --- | --- |
| Company | "CASH BILL (F.Y. 2026-27)", State Tamil Nadu, GSTIN field blank | See open question OQ-1. Design for a GSTIN-bearing company regardless. |
| Items | 4,267 items, 39 item groups, two-level hierarchy (e.g. GI CLAMP under GI FITTING, MOTAR under FINOLEX). Alias codes used as quick lookup (1500, 8450, G84, C39). Units: Pcs, Metre. Opening stock can be negative. | Alias search is the primary lookup at the counter. Decimal quantities exist (127.05 Metre). Negative stock must be allowed but flagged. |
| Accounts | 31 account groups (standard Busy chart). Parties under Sundry Debtors. Receipts routed to `Cash` and `GPAY SELVAM` (a UPI/bank account). | Ledger is standard double-entry. Need Cash, Bank/UPI, Sales, Purchase, Duties & Taxes, Sundry Debtors/Creditors at minimum. |
| Sales voucher | Series "Main", Sale Type "Udhaya", Party default Cash, Broker field "OFFICE", 13-row item grid (Item, Qty, Unit, List Price, Disc %, Tot Dis, Price, Amount), Bill Sundries: Discount (-), Freight & Forwarding (+), tax breakup by rate (CGST/SGST), Settlement, Total. Keys: Esc Quit, F2 Done, F4 Std Narration, F7 Repeat, F9 Delete line, F11 Orders, F5 List, F12 Paste. | This screen is the product. Replicate field order and keys exactly (§7). |
| Party ledger | Running balance with Dr/Cr, opening balance, per-voucher rows, mixed Sale/Rcpt. Party example: AYAPPAN PIPE KUTTALAM, closing Rs 2,365.00 Dr. | Ledger report = golden-file test fixture. |
| GST Summary | Input/Output/Dr-Cr note tables; Tax Calculation (opening, input, ITC reversal, RCM, output, adjustment, payable); Tax Payable with Payment details; RCM block. Period 01-04-2026 to 02-09-2026. | Phase 4 report. Numbers in screenshot are the acceptance fixture. |
| Menus used | Transactions (Sales, Sales Return, Purchase, Purchase Return, Payment, Receipt, Journal, Contra, Dr/Cr Note w/o items, Stock Journal, Physical Stock), Display (ledgers, trial balance, balance sheet, stock status, GST reports, day book), House-Keeping (reindex, rewrite books, update balances), Administration (masters, change FY), Add-On (barcode/label printing). Favourites: DAY SUMMARY, Day Book, Data Export/Import – PURCHASE BILL. | Everything else in Busy is out of scope unless added to TASKS.md. |
| Data quality | Opening stock total -49,031.14; items like 1" BLACK SCREW at -897 pcs; GST payable 3,23,667.82 with nil payment recorded. | Import must tolerate this and produce an exceptions report. Do not "fix" data silently. |

---

## 3. Scope

### In scope (v1, by cutover)
Masters: item groups (hierarchical), items (alias, HSN, unit, tax rate with effective date, prices, min stock), account groups, accounts/parties (GSTIN, state, credit terms), sale types, brokers, voucher series, bill sundries, users.
Vouchers: Sales, Sales Return (Cr Note), Purchase, Purchase Return (Dr Note), Receipt, Payment, Journal, Contra, Dr/Cr Note without items, Stock Journal, Physical Stock.
Reports: Day Book, Day Summary, Account Ledger, Outstanding (party-wise), Trial Balance, P&L, Balance Sheet, Stock Status, Item Ledger, Sales/Purchase Register, GST Summary, GSTR-1 (B2C small, B2B, HSN summary, documents issued) and GSTR-3B table 3.1 as JSON/CSV for the CA.
Operations: printing (A4 invoice, 80 mm thermal receipt), automatic backup, restore, change financial year with carry-forward, user PIN login with owner/staff roles, audit log, Busy XML import.

### Out of scope (v1)
Multi-user/LAN, cloud sync, mobile, e-way bill, e-invoice/IRN (not applicable below Rs 5 crore AATO — see §8), barcode label design (print plain labels only), interest calculation, depreciation, brokerage calculation, MIS dashboards, SMS/email, multi-currency, batch/expiry tracking, order processing (sales/purchase orders) unless the shop confirms they use it.

---

## 4. Getting the data out of Busy

Busy has two export paths. Use both; the XML is the import source, the Excel reports are the reconciliation fixtures.

1. XML (structured, complete): `Administration → Data Export Import → Data Export/Import (XML) → Export Data`. Export Masters (select all) and Transactions (select all voucher types) for 01-04-2026 to the export date into a folder. Repeat for previous FY if history is wanted.
2. Report exports (ALT+E on any list or report → Excel/CSV): List of Items, List of Item Groups, List of Account Groups, List of Accounts, Account Ledger for 10 representative parties, Stock Status, Trial Balance, GST Summary, Day Book for one full month. These are the golden files in `packages/core/test/fixtures/busy/`.
3. Take a Busy backup (`Company → Backup`) before touching anything and keep it with the exports.

Rules for the importer:
- Parse Busy's XML with a streaming parser; the voucher file for a full year will be large.
- Everything imported keeps its Busy identifier in a `legacy_ref` column so reconciliation can join on it.
- The importer writes `import_exceptions.csv` (negative stock, missing HSN, missing tax rate, unbalanced vouchers, duplicate aliases). It never aborts on data problems; it aborts only on schema problems.
- Import is idempotent: re-running on the same export produces zero changes.

---

## 5. Architecture

```
shopledger/
  CLAUDE.md
  docs/            KICKOFF.md  TASKS.md  DECISIONS.md  SESSION_LOG.md  gst/  ui/
  packages/core/   src/domain  src/db  src/import  src/reports  src/print  migrations/  test/
  apps/desktop/    src/main  src/preload  src/ipc  src/renderer
  .claude/         settings.json  skills/  agents/
```

Decisions and the reasons (also logged in DECISIONS.md):

- **Electron, not Tauri, not Django.** One language across main/renderer/core keeps Claude Code sessions cheap and debugging simple. Electron 37+ bundles Node 24, so SQLite comes from the built-in `node:sqlite` module: no native addon, no ABI rebuilds, no node-gyp on the shop PC. Bundle size (~150 MB) is irrelevant on a single shop PC. Tauri would push business logic into Rust or into the renderer; Django would add a second runtime and Windows service packaging.
- **`packages/core` is shell-agnostic.** It must run under plain Node for tests and under Electron's main process. If Electron ever has to be replaced, core survives.
- **No ORM.** Hand-written SQL in repository modules with zod-typed row mappers. The schema is small (about 25 tables) and accounting queries are easier to audit as SQL.
- **Synchronous DB access in main process.** `node:sqlite` is synchronous; SQLite is single-writer; a shop PC issues one write at a time. Simpler than async plumbing and faster.
- **IPC contract.** `apps/desktop/src/ipc/contract.ts` declares every channel with zod request/response schemas. Preload exposes only those. Renderer imports the inferred types. This is the only boundary.
- **Printing.** Invoice HTML templates in `packages/core/src/print/`, rendered in a hidden BrowserWindow, printed with `webContents.print({silent: true, deviceName})`. Two templates: `a4-invoice.html`, `thermal-80mm.html`. Printer name stored in settings.
- **Backups.** `VACUUM INTO` to `%ProgramData%/ShopLedger/backups/YYYY-MM-DD_HHmm.db` on app close and every day at 14:00 and 20:00 while running; copy to a removable drive if one is present; keep last 30 daily + 12 monthly. Restore is a menu item that validates the file (`PRAGMA integrity_check`) before swapping.
- **Users.** Local table, 4–6 digit PIN hashed with argon2id, roles owner/staff. Staff cannot cancel vouchers after the day is closed, cannot see P&L.

---

## 6. Data model (core tables)

All money columns are `INTEGER` paise. All quantity columns are `INTEGER` thousandths. All dates `TEXT` ISO.

```
financial_year        id, start_date, end_date, is_locked
account_group         id, name, parent_id, nature (asset|liability|income|expense), is_system
account               id, name, group_id, opening_balance_paise, opening_is_dr, gstin, state_code, phone, address, credit_days, is_system, legacy_ref
item_group            id, name, parent_id, legacy_ref
unit                  id, name, decimals (0 or 3)
item                  id, name, alias, group_id, unit_id, hsn, opening_qty, opening_rate_paise, sale_price_paise, mrp_paise, min_stock_qty, is_active, legacy_ref
item_tax_rate         item_id, effective_from, rate_bp (basis points: 1800 = 18%)   -- rate history, required since 22-09-2025 restructure
sale_type             id, name, tax_mode (local|interstate|exempt), default_series_id
voucher_series        id, voucher_type, name, prefix, next_no_per_fy (json)
bill_sundry           id, name, sign (+1|-1), affects_taxable (bool), account_id
voucher               id, voucher_type, series_id, number, date, fy_id, party_account_id, sale_type_id, broker, narration, status (draft|posted|cancelled), subtotal_paise, taxable_paise, tax_paise, round_off_paise, total_paise, created_by, created_at, modified_at, legacy_ref
voucher_item          id, voucher_id, line_no, item_id, qty, unit_id, list_price_paise, disc_bp, price_paise, amount_paise, tax_rate_bp, taxable_paise, cgst_paise, sgst_paise, igst_paise
voucher_sundry        id, voucher_id, bill_sundry_id, amount_paise
voucher_settlement    id, voucher_id, account_id (Cash / GPAY etc.), amount_paise   -- for cash bills settled on the spot
journal_line          id, voucher_id, account_id, dr_paise, cr_paise, line_no          -- CHECK (dr=0 OR cr=0)
stock_movement        id, voucher_id, item_id, qty_in, qty_out, rate_paise, date
audit_log             id, at, user_id, action, table_name, row_id, before_json, after_json
user                  id, name, pin_hash, role, is_active
setting               key, value
schema_version        version, applied_at
```

Invariants enforced in core and covered by property tests:
1. For every `voucher` with status `posted`: `SUM(dr) = SUM(cr)` over its `journal_line`s, and `SUM(dr) > 0`.
2. For every item: `opening_qty + SUM(qty_in) - SUM(qty_out)` equals the value shown on Stock Status.
3. Cancelling a voucher inserts exact reversal journal and stock lines; it never updates or deletes originals.
4. Account ledger closing balance for any date range equals opening + movements, recomputed from `journal_line` only (no cached balances in v1).
5. Voucher numbers within (type, series, fy) are contiguous after sorting by number.

Tax computation rule (document in `docs/gst/rounding.md` after confirming with the CA): compute tax per line in paise with round-half-up; sum lines per rate for the invoice tax table; apply bill sundries that affect taxable value proportionally across lines before tax; optional round-off of the grand total to the nearest rupee posted to a Round Off account.

---

## 7. Keyboard contract (must match Busy so staff need no retraining)

Global: `F1` help, `F2` add item master, `F3` add account/master, `F5` add payment, `F6` add receipt, `F7` add journal, `F8` add sales, `F9` add purchase, `B` balance sheet, `T` trial balance, `S` stock status, `A` account summary, `L` account ledger, `I` item summary, `G` item ledger, `V` GST summary, `U` switch user, `F10` calculator.

Inside a voucher: `Esc` quit (confirm if dirty), `F2` save/done, `F4` standard narration, `F5` list/lookup popup on the current field, `F7` repeat previous line, `F9` delete current line, `F11` orders, `F12` paste from last voucher, `Enter` moves to the next field in Busy's order, `Shift+Enter` previous field, `Alt+B` modify sales.

Added after the first release (full list in `docs/ui/keymap.md`): inside a bill `F3` last price, `Alt+H` set the bill aside, `Alt+R` bring a set-aside bill back; on a bill being viewed `Alt+N` copy as new bill; on the Items list `Alt+P` change prices (owner); on any report `Ctrl+S` save as PDF.

Item lookup: typing in the Item cell searches `alias` exact first, then `name` prefix, then name contains; `Enter` picks the highlighted row. Numeric alias entry must resolve without opening the popup.

Any new screen must add its keys to `docs/ui/keymap.md` in the same session it is built.

---

## 8. GST and compliance facts the design depends on

Verified 1 October 2026; re-check with the CA before Phase 4. The CA's word overrides this file.

- Rate structure: since 22 September 2025 GST has two main slabs, 5% and 18%, plus a 40% demerit band. Electrical goods, fans, wires, PVC/CPVC pipes and fittings are overwhelmingly 18%; a few categories moved to 5%. Because rates changed mid-FY 2025-26, `item_tax_rate` carries an effective-from date and vouchers freeze the rate used.
- E-invoicing (IRN) applies only to GST-registered businesses with aggregate annual turnover above Rs 5 crore in any FY since 2017-18, and never to B2C invoices. The shop's run-rate (about Rs 20 lakh taxable output for Apr–Sep 2026 in the file seen) is far below this. Not in scope; keep `voucher` extensible with `irn`, `ack_no`, `ack_date` nullable columns so it can be added later.
- HSN: minimum 4 digits for turnover up to Rs 5 crore, 6 digits above. Store up to 8 digits; validate 4 minimum on sales vouchers; report at the digit count the CA specifies.
- GSTR-1 for this profile: Table 7 (B2C small, state-wise rate-wise), Table 4 (B2B, if any registered customers), Table 9/10 amendments (out of scope), Table 12 HSN summary, Table 13 documents issued (requires gap-free numbering per series). GSTR-3B: table 3.1 outward supplies, 4 eligible ITC from purchases. Output both as CSV matching the GST offline tool column headers and as a human-readable PDF.
- QRMP (quarterly GSTR-1/3B, monthly PMT-06) is available up to Rs 5 crore; the report period filter must therefore support monthly and quarterly.
- Credit/debit notes must reference the original invoice number and date.
- Keep records for 72 months from the annual return due date; backups are therefore never auto-purged below the 12-monthly tier.

---

## 9. Phases, deliverables and acceptance

Each phase ends with: all tests green, `pnpm typecheck` clean, a git tag `vX.Y`, TASKS.md updated, and a 5-minute demo on the real shop PC (not only the dev laptop).

### Phase 0 — Foundation (target: 2 sessions)
- Repo scaffold per §5, pnpm workspace, Electron + Vite + React running, `node:sqlite` opened in WAL mode, migration runner, `schema_version`, Vitest + Playwright wired, eslint/prettier, `.claude/settings.json` hooks, DECISIONS.md and TASKS.md seeded.
- Accept: `pnpm dev` opens a window showing DB path and schema version; `pnpm test` runs one passing test against in-memory SQLite; `pnpm e2e` launches the app and closes it.

### Phase 1 — Import and read-only truth (target: 4–5 sessions)
- Busy XML importer for masters and all voucher types; exceptions report; `legacy_ref` on every row.
- Posting engine: every imported voucher produces journal and stock lines.
- Read-only screens: Account Ledger, Stock Status, Trial Balance, GST Summary, Day Book.
- Accept (golden files): Account Ledger for the 10 exported parties matches Busy row for row and closing balance to the paisa; Stock Status quantities match; Trial Balance totals match; GST Summary for 01-04-2026 to the export date matches every cell shown in the screenshot. Differences are either fixed or written to `docs/reconciliation.md` with the reason.

### Phase 2 — Counter (target: 5–6 sessions)
- Masters CRUD with keyboard flow; Sales voucher screen per §2/§7 including bill sundries, tax table, settlement to Cash/UPI; Receipt voucher; A4 and thermal printing; party dashboard (balance, last 5 bills).
- Accept: timed test — 5-line cash bill entered and printed in under 25 s by a staff member; Playwright E2E covers bill entry entirely via keyboard; printed invoice reviewed by the CA for mandatory fields (supplier name, address, GSTIN, invoice no/date, HSN, taxable value, rate-wise CGST/SGST, total, signature block).
- Shadow mode starts: staff enter every bill in both systems; daily reconciliation script `pnpm recon <busy-export-dir>` prints differences.

### Phase 3 — Full books (target: 4–5 sessions)
- Purchase, Sales Return, Purchase Return, Payment, Journal, Contra, Dr/Cr Note w/o items, Stock Journal, Physical Stock; voucher modify and cancel with audit; Outstanding report; Sales and Purchase registers.
- Accept: one full month of shadow data reconciles with Busy across all voucher types with zero unexplained differences.

### Phase 4 — Statutory reports (target: 3 sessions)
- P&L, Balance Sheet, GSTR-1 and GSTR-3B exports, HSN summary, documents issued. CA reviews one month's output side by side with Busy's.
- Accept: CA sign-off recorded in `docs/reconciliation.md`.

### Phase 5 — Operations and cutover (target: 3 sessions)
- Users/PIN/roles, audit viewer, backup/restore, change FY with carry-forward of balances and stock, installer, auto-launch, printer settings, restore drill.
- Accept: fresh install on the shop PC from the installer, restore of yesterday's backup, FY roll from 2026-27 to 2027-28 on a copy, power-cut test mid-entry (pull the plug) with `PRAGMA integrity_check` clean afterwards.
- Cutover 1 April 2027. Busy stays installed read-only for one FY for reference.

Total: 21–24 sessions. See §12 for what that costs.

---

## 10. Testing strategy

Layers, cheapest first. Claude must run the relevant layer before claiming a task is done and paste the output.

1. **Typecheck and lint** on every edit (hook). Zero tolerance.
2. **Unit tests (Vitest, core)**: one test file per domain module. In-memory SQLite created from the real migrations, so schema drift fails tests immediately. Money/quantity helpers tested at boundaries (0, 1 paisa, rounding half-up, 3-dp quantities).
3. **Invariant tests (fast-check)**: generate random vouchers (types, lines, discounts, sundries, rates) and assert the five invariants in §6 after posting and after cancelling. Minimum 500 runs in CI, 5,000 before a phase tag.
4. **Golden-file tests**: fixtures exported from Busy (§4). Reports are rendered to a normalised CSV and diffed. A failing golden test is a reconciliation finding, not a test to delete.
5. **Importer tests**: a hand-built small Busy XML sample covering every voucher type and every exception class; assert idempotency by importing twice.
6. **E2E (Playwright for Electron)**: three flows only — keyboard-only cash bill entry and print-preview, receipt against a party and ledger check, cancel a voucher and verify reversal. Run before each phase tag, not on every commit.
7. **Manual acceptance** on the shop PC per §9, logged in `docs/reconciliation.md`.

Rules: no mocking the database; no snapshot tests of UI HTML; a bug fix adds a failing test first; test names describe the business rule ("cancelling a sales voucher restores stock").

---

## 11. Tracking

Everything lives in the repo so Claude Code can read and update it without another tool.

- `docs/TASKS.md`: the only backlog. Phases → tasks with ids `P2-07`, status (todo | doing | done | blocked), acceptance line, and the session that closed it. Claude updates it at the end of every session; Tony reviews the diff.
- `docs/DECISIONS.md`: dated one-paragraph ADRs. Anything that constrains future work goes here, including dependency additions and gotchas.
- `docs/SESSION_LOG.md`: one line per session — date, task id, model, `/usage` cost, outcome. This is the budget ledger.
- `docs/reconciliation.md`: every difference found against Busy, with cause and resolution. This file is what the CA reads.
- Git: `main` is always releasable. One branch per task (`p2-07-sales-voucher`), squash-merge, tag `v0.<phase>.<n>` at phase end. Conventional commits.
- No GitHub Issues/Projects for v1; the markdown board is enough for one builder and avoids MCP overhead in every session.

---

## 12. Working with Claude Code on USD 250

Reference figures from Anthropic's docs: average about USD 13 per active day, 90% of users under USD 30 per active day, mostly driven by long uncleared sessions and Opus as default. On that basis USD 250 is roughly 12–18 disciplined sessions, which is fewer than the 21–24 in §9. The plan below is designed to land inside the budget; if it does not, Phase 5 and parts of Phase 4 are what get deferred, not Phases 1–3.

Model policy
- Default model: Sonnet (`/model`). Effort: medium. Set in `.claude/settings.json` so every session starts there.
- Opus only for: the Phase 0 architecture pass, the posting-engine design in Phase 1, and the GST computation design in Phase 4. Switch back to Sonnet before implementation.
- Subagents for tests and log reading run on Haiku (`model: haiku` in `.claude/agents/`).

Session discipline
- `claude --permission-mode plan --name "P2-07"` to start. Plan, approve, implement.
- One TASKS.md item per session. `/clear` before starting another.
- Run `/usage` before `/clear` and log the cost. Stop for the day at USD 25.
- Hooks (in `.claude/settings.json`) filter test output to failures only and run lint on edits, so Claude does not read 2,000 lines of passing output.
- Keep CLAUDE.md under 120 lines. Workflow detail belongs in skills (`.claude/skills/`) that load on demand.
- If Claude has been corrected twice on the same point, `/clear` and rewrite the prompt instead of a third correction.
- Reserve USD 50 for shadow-mode bug fixes. Treat USD 200 as the build ceiling.

Session playbook (first six)

| # | Mode | Prompt (abridged) | Done when |
| --- | --- | --- | --- |
| 0a | Opus, plan | "Read CLAUDE.md and docs/KICKOFF.md. Interview me using AskUserQuestion about anything in §2–§8 you think is ambiguous, then write docs/TASKS.md with every task for Phase 0 and Phase 1 in the format of §11. Do not write code." | TASKS.md reviewed and committed |
| 0b | Sonnet | "Implement P0-01..P0-06 from TASKS.md: scaffold per KICKOFF §5. Finish with `pnpm dev` opening a window and `pnpm test` green. Paste the outputs." | Phase 0 acceptance |
| 1a | Sonnet | "Implement the Busy XML parser (P1-01). Fixture is at test/fixtures/busy/sample/. Streaming parser, idempotent, exceptions CSV. Tests first." | importer tests green |
| 1b | Opus, plan → Sonnet | "Design the posting engine for all voucher types per KICKOFF §6 invariants. Write the plan, then implement with fast-check tests at 500 runs." | invariant tests green |
| 1c | Sonnet | "Build the Account Ledger report and the golden-file harness. Make the ledger for AYAPPAN PIPE KUTTALAM match test/fixtures/busy/ledger_ayappan.csv." | golden test green |
| 1d | Sonnet | "GST Summary report. Fixture: docs/gst/busy_gst_summary_2026-04-01_to_2026-09-02.csv. Every cell must match." | golden test green |

Each later task follows the same shape: cite the task id, name the fixture or test that proves it, ask for pasted output.

---

## 13. Risks

| Risk | Mitigation |
| --- | --- |
| Busy XML lacks something the UI needs (e.g. bill-sundry detail, settlement split) | Validate on the first export before Phase 1 planning; fall back to ALT+E report exports for that entity. |
| Rounding differences vs Busy in tax | Decide rounding rule with CA in Phase 1; golden tests pin it; never "match Busy" by adding fudge factors. |
| Staff reject the new screen | Keyboard contract (§7) is non-negotiable; shadow mode for a full month; owner's go/no-go, not the developer's. |
| Data corruption on the shop PC | WAL + transactions; integrity check on every start; backup on close; restore drill in Phase 5. |
| Budget exhausted before Phase 4 | Phases 1–3 deliver a working counter plus books; CA can continue to compute GST from exported registers until Phase 4 is funded. |
| Scope creep from Busy feature list | Anything not in §3 needs a TASKS.md entry with an acceptance line before any code. |

---

## 14. Open questions (answer before the Phase 1 planning session)

- OQ-1: What is the "CASH BILL" company file in Busy, and where is the shop's GSTIN-registered company file kept? If a second company exists, its data is also in scope for import.
- OQ-2: Does the shop use Sales/Purchase Orders, Material Issued/Received, or batch tracking? Screenshots show the menus but not usage.
- OQ-3: Which printer(s) and paper sizes are in use at the counter? Thermal width, A4 pre-printed or plain.
- OQ-4: Do any customers buy on credit with GSTIN (B2B)? Determines whether GSTR-1 Table 4 is needed in v1.
- OQ-5: Tax rounding convention the CA wants (per line vs per invoice; round-off ledger yes/no).
- OQ-6: Should history before FY 2026-27 be imported, or only opening balances as of 01-04-2026?
- OQ-7: Who closes the day, and should staff be blocked from editing vouchers after day close?
