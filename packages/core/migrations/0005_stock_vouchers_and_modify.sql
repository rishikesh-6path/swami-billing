-- 1. voucher_series CHECK must also allow the two stock-only voucher types. SQLite cannot alter a
--    CHECK, so the table is rebuilt. Foreign keys are deferred until COMMIT, by which time every
--    child row points at an identical row (same ids) in the rebuilt table.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE voucher_series_new (
  id           INTEGER PRIMARY KEY,
  voucher_type TEXT NOT NULL CHECK (voucher_type IN (
    'sales', 'sales_return', 'purchase', 'purchase_return', 'receipt', 'payment',
    'journal', 'contra', 'debit_note', 'credit_note', 'stock_journal', 'physical_stock')),
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL DEFAULT '',
  UNIQUE (voucher_type, name)
) STRICT;
INSERT INTO voucher_series_new (id, voucher_type, name, prefix)
  SELECT id, voucher_type, name, prefix FROM voucher_series;
DROP TABLE voucher_series;
ALTER TABLE voucher_series_new RENAME TO voucher_series;

-- 2. A modified voucher is a cancelled original plus a replacement that points back at it.
ALTER TABLE voucher ADD COLUMN modified_from_id INTEGER REFERENCES voucher (id);
