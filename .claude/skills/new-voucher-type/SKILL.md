---
name: new-voucher-type
description: Checklist for adding or changing a voucher type (sales, purchase, receipt, etc.) so posting, stock, numbering, audit, print and tests all land together.
---
# Adding a voucher type

1. Read `packages/core/src/domain/posting/` for an existing type and copy its shape.
2. Define the posting rules table (which accounts get Dr/Cr for each amount component) in a comment at the top of the module, then in code.
3. Stock effect: in/out/none. Add to `stock_movement` writer.
4. Numbering: register the type in `voucher_series`. Number assigned inside the insert transaction.
5. Cancel path: reversal of journal and stock lines; original untouched; audit_log row.
6. Tests, in order: unit (one happy path, one unbalanced throws), fast-check invariants §6 (500 runs), golden file if Busy has the same report.
7. IPC channel in `apps/desktop/src/ipc/contract.ts` with zod schemas.
8. Screen: field order and keys per KICKOFF §7; append to `docs/ui/keymap.md`.
9. Print template if the type is printable.
10. Run `ledger-reviewer` subagent on the diff. Update TASKS.md.
