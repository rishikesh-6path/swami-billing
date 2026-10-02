# SESSION LOG — budget ledger (USD 250 total, USD 200 build ceiling, USD 50 reserve)

date | session name | task id | model | /usage cost USD | running total | outcome
--- | --- | --- | --- | --- | --- | ---
2026-10-01 | P0-kickoff | P0-01..P0-06 | opus (plan), sonnet (implement) | TBD (run /usage) | TBD | Phase 0 scaffold complete; `pnpm test`, `pnpm e2e`, `pnpm dev` verified in cloud container, shop-PC demo pending
2026-10-01 | P0-kickoff (continued, autonomous loop) | P3-08, P4-01..P4-04, P2-05 UI | sonnet | TBD (run /usage) | TBD | Print, backup and restore, settings, spreadsheet import, calculator, installer config, docs; 28 E2E and 218 core tests green; Windows installer, real printer and restore drill pending on the shop PC
2026-10-01 | P0-kickoff (continued, review round) | review fixes, frozen bills, standard notes | sonnet + 3 review agents | TBD (run /usage) | TBD | Three adversarial reviews (print, core operations, desktop/IPC) found about 40 issues; all high and medium findings fixed with tests; 250 core and 31 E2E tests green
2026-10-02 | P0-kickoff (continued, build round 2) | P5-01..P5-04 | sonnet + 2 review agents | TBD (run /usage) | TBD | Supplier invoice number and duplicate check, credit and debit notes that reach GSTR-1 and 3B, customer and supplier summary page, background backups, faster import, dialog focus; 280 core and 41 E2E tests green; the packaged Linux build runs the backup worker
2026-10-02 | P0-kickoff (continued, build round 3) | P6-04 | sonnet | TBD (run /usage) | TBD | Speed at real size: Items to Order 16 s to 0.14 s, indexes in migration 0010, timing test on an 8,000-bill shop
