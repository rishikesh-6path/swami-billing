-- Domain schema per docs/KICKOFF.md section 6.
-- Money: INTEGER paise. Quantity: INTEGER thousandths. Rates/discounts: INTEGER basis points.
-- Dates: TEXT 'YYYY-MM-DD'. Booleans: INTEGER 0/1.

CREATE TABLE financial_year (
  id         INTEGER PRIMARY KEY,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  is_locked  INTEGER NOT NULL DEFAULT 0 CHECK (is_locked IN (0, 1)),
  CHECK (start_date < end_date),
  UNIQUE (start_date)
) STRICT;

CREATE TABLE account_group (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  parent_id INTEGER REFERENCES account_group (id),
  nature    TEXT NOT NULL CHECK (nature IN ('asset', 'liability', 'income', 'expense')),
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1))
) STRICT;

CREATE TABLE account (
  id                    INTEGER PRIMARY KEY,
  name                  TEXT NOT NULL UNIQUE,
  group_id              INTEGER NOT NULL REFERENCES account_group (id),
  opening_balance_paise INTEGER NOT NULL DEFAULT 0 CHECK (opening_balance_paise >= 0),
  opening_is_dr         INTEGER NOT NULL DEFAULT 1 CHECK (opening_is_dr IN (0, 1)),
  gstin                 TEXT,
  state_code            TEXT,
  phone                 TEXT,
  address               TEXT,
  credit_days           INTEGER NOT NULL DEFAULT 0 CHECK (credit_days >= 0),
  is_system             INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  legacy_ref            TEXT UNIQUE
) STRICT;

CREATE TABLE item_group (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  INTEGER REFERENCES item_group (id),
  legacy_ref TEXT UNIQUE,
  UNIQUE (parent_id, name)
) STRICT;

CREATE TABLE unit (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL UNIQUE,
  decimals INTEGER NOT NULL CHECK (decimals IN (0, 3))
) STRICT;

CREATE TABLE item (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE,
  alias              TEXT,
  group_id           INTEGER NOT NULL REFERENCES item_group (id),
  unit_id            INTEGER NOT NULL REFERENCES unit (id),
  hsn                TEXT CHECK (hsn IS NULL OR (length(hsn) BETWEEN 4 AND 8 AND hsn NOT GLOB '*[^0-9]*')),
  opening_qty        INTEGER NOT NULL DEFAULT 0,  -- may be negative: Busy data has negative stock
  opening_rate_paise INTEGER NOT NULL DEFAULT 0 CHECK (opening_rate_paise >= 0),
  sale_price_paise   INTEGER NOT NULL DEFAULT 0 CHECK (sale_price_paise >= 0),
  mrp_paise          INTEGER NOT NULL DEFAULT 0 CHECK (mrp_paise >= 0),
  min_stock_qty      INTEGER NOT NULL DEFAULT 0 CHECK (min_stock_qty >= 0),
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  legacy_ref         TEXT UNIQUE
) STRICT;
CREATE INDEX item_alias_idx ON item (alias);

-- Rate history: rates changed mid-FY 2025-26, and vouchers freeze the rate they used.
CREATE TABLE item_tax_rate (
  item_id        INTEGER NOT NULL REFERENCES item (id),
  effective_from TEXT NOT NULL,
  rate_bp        INTEGER NOT NULL CHECK (rate_bp >= 0),
  PRIMARY KEY (item_id, effective_from)
) STRICT;

CREATE TABLE sale_type (
  id                INTEGER PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  tax_mode          TEXT NOT NULL CHECK (tax_mode IN ('local', 'interstate', 'exempt')),
  default_series_id INTEGER
) STRICT;

CREATE TABLE voucher_series (
  id           INTEGER PRIMARY KEY,
  voucher_type TEXT NOT NULL CHECK (voucher_type IN (
    'sales', 'sales_return', 'purchase', 'purchase_return', 'receipt', 'payment',
    'journal', 'contra', 'debit_note', 'credit_note', 'stock_journal', 'physical_stock')),
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL DEFAULT '',
  UNIQUE (voucher_type, name)
) STRICT;

-- Gap-free numbering: one counter per (type, series, financial year), bumped inside the
-- voucher insert transaction. (Replaces the json next_no_per_fy column sketched in section 6.)
CREATE TABLE voucher_counter (
  voucher_type TEXT NOT NULL,
  series_id    INTEGER NOT NULL REFERENCES voucher_series (id),
  fy_id        INTEGER NOT NULL REFERENCES financial_year (id),
  last_no      INTEGER NOT NULL DEFAULT 0 CHECK (last_no >= 0),
  PRIMARY KEY (voucher_type, series_id, fy_id)
) STRICT;

CREATE TABLE bill_sundry (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  sign             INTEGER NOT NULL CHECK (sign IN (1, -1)),
  affects_taxable  INTEGER NOT NULL DEFAULT 1 CHECK (affects_taxable IN (0, 1)),
  account_id       INTEGER NOT NULL REFERENCES account (id)
) STRICT;

CREATE TABLE user (
  id        INTEGER PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  pin_hash  TEXT NOT NULL,
  role      TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
) STRICT;

CREATE TABLE voucher (
  id               INTEGER PRIMARY KEY,
  voucher_type     TEXT NOT NULL,
  series_id        INTEGER NOT NULL REFERENCES voucher_series (id),
  number           INTEGER NOT NULL CHECK (number > 0),
  date             TEXT NOT NULL,
  fy_id            INTEGER NOT NULL REFERENCES financial_year (id),
  party_account_id INTEGER REFERENCES account (id),
  sale_type_id     INTEGER REFERENCES sale_type (id),
  broker           TEXT,
  narration        TEXT,
  status           TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'cancelled')),
  subtotal_paise   INTEGER NOT NULL DEFAULT 0,
  taxable_paise    INTEGER NOT NULL DEFAULT 0,
  tax_paise        INTEGER NOT NULL DEFAULT 0,
  round_off_paise  INTEGER NOT NULL DEFAULT 0,
  total_paise      INTEGER NOT NULL DEFAULT 0,
  ref_voucher_id   INTEGER REFERENCES voucher (id),  -- original invoice for credit/debit notes
  irn              TEXT,                              -- e-invoicing hooks, unused in v1
  ack_no           TEXT,
  ack_date         TEXT,
  created_by       INTEGER REFERENCES user (id),
  created_at       TEXT NOT NULL,
  modified_at      TEXT NOT NULL,
  legacy_ref       TEXT UNIQUE,
  UNIQUE (voucher_type, series_id, fy_id, number)
) STRICT;
CREATE INDEX voucher_date_idx ON voucher (date);
CREATE INDEX voucher_party_idx ON voucher (party_account_id, date);

CREATE TABLE voucher_item (
  id               INTEGER PRIMARY KEY,
  voucher_id       INTEGER NOT NULL REFERENCES voucher (id),
  line_no          INTEGER NOT NULL,
  item_id          INTEGER NOT NULL REFERENCES item (id),
  qty              INTEGER NOT NULL,
  unit_id          INTEGER NOT NULL REFERENCES unit (id),
  list_price_paise INTEGER NOT NULL CHECK (list_price_paise >= 0),
  disc_bp          INTEGER NOT NULL DEFAULT 0 CHECK (disc_bp BETWEEN 0 AND 10000),
  price_paise      INTEGER NOT NULL CHECK (price_paise >= 0),
  amount_paise     INTEGER NOT NULL,
  hsn              TEXT,                              -- frozen on the voucher
  tax_rate_bp      INTEGER NOT NULL DEFAULT 0 CHECK (tax_rate_bp >= 0),  -- frozen on the voucher
  taxable_paise    INTEGER NOT NULL DEFAULT 0,
  cgst_paise       INTEGER NOT NULL DEFAULT 0,
  sgst_paise       INTEGER NOT NULL DEFAULT 0,
  igst_paise       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (voucher_id, line_no)
) STRICT;

CREATE TABLE voucher_sundry (
  id             INTEGER PRIMARY KEY,
  voucher_id     INTEGER NOT NULL REFERENCES voucher (id),
  bill_sundry_id INTEGER NOT NULL REFERENCES bill_sundry (id),
  amount_paise   INTEGER NOT NULL
) STRICT;

-- Cash bills settled on the spot (Cash / GPay etc.).
CREATE TABLE voucher_settlement (
  id           INTEGER PRIMARY KEY,
  voucher_id   INTEGER NOT NULL REFERENCES voucher (id),
  account_id   INTEGER NOT NULL REFERENCES account (id),
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0)
) STRICT;

CREATE TABLE journal_line (
  id          INTEGER PRIMARY KEY,
  voucher_id  INTEGER NOT NULL REFERENCES voucher (id),
  account_id  INTEGER NOT NULL REFERENCES account (id),
  dr_paise    INTEGER NOT NULL DEFAULT 0 CHECK (dr_paise >= 0),
  cr_paise    INTEGER NOT NULL DEFAULT 0 CHECK (cr_paise >= 0),
  line_no     INTEGER NOT NULL,
  is_reversal INTEGER NOT NULL DEFAULT 0 CHECK (is_reversal IN (0, 1)),
  CHECK (dr_paise = 0 OR cr_paise = 0)
) STRICT;
CREATE INDEX journal_line_account_idx ON journal_line (account_id);
CREATE INDEX journal_line_voucher_idx ON journal_line (voucher_id);

CREATE TABLE stock_movement (
  id          INTEGER PRIMARY KEY,
  voucher_id  INTEGER NOT NULL REFERENCES voucher (id),
  item_id     INTEGER NOT NULL REFERENCES item (id),
  qty_in      INTEGER NOT NULL DEFAULT 0 CHECK (qty_in >= 0),
  qty_out     INTEGER NOT NULL DEFAULT 0 CHECK (qty_out >= 0),
  rate_paise  INTEGER NOT NULL DEFAULT 0 CHECK (rate_paise >= 0),
  date        TEXT NOT NULL,
  is_reversal INTEGER NOT NULL DEFAULT 0 CHECK (is_reversal IN (0, 1)),
  CHECK (qty_in = 0 OR qty_out = 0)
) STRICT;
CREATE INDEX stock_movement_item_idx ON stock_movement (item_id, date);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL,
  user_id     INTEGER REFERENCES user (id),
  action      TEXT NOT NULL,
  table_name  TEXT NOT NULL,
  row_id      INTEGER NOT NULL,
  before_json TEXT,
  after_json  TEXT
) STRICT;

-- Immutability guards (hard rules: vouchers are never hard-deleted; cancel inserts reversals).
CREATE TRIGGER voucher_no_delete BEFORE DELETE ON voucher
BEGIN SELECT RAISE(ABORT, 'vouchers cannot be deleted; cancel them instead'); END;

CREATE TRIGGER journal_line_no_delete BEFORE DELETE ON journal_line
BEGIN SELECT RAISE(ABORT, 'journal lines cannot be deleted; post a reversal instead'); END;

CREATE TRIGGER journal_line_no_update BEFORE UPDATE ON journal_line
BEGIN SELECT RAISE(ABORT, 'journal lines cannot be changed; post a reversal instead'); END;

CREATE TRIGGER stock_movement_no_delete BEFORE DELETE ON stock_movement
BEGIN SELECT RAISE(ABORT, 'stock movements cannot be deleted; post a reversal instead'); END;

CREATE TRIGGER stock_movement_no_update BEFORE UPDATE ON stock_movement
BEGIN SELECT RAISE(ABORT, 'stock movements cannot be changed; post a reversal instead'); END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;

-- A cancelled voucher stays cancelled, and its number/date/type can never change.
CREATE TRIGGER voucher_identity_frozen BEFORE UPDATE ON voucher
WHEN OLD.voucher_type <> NEW.voucher_type OR OLD.series_id <> NEW.series_id
  OR OLD.number <> NEW.number OR OLD.fy_id <> NEW.fy_id
  OR (OLD.status = 'cancelled' AND NEW.status <> 'cancelled')
BEGIN SELECT RAISE(ABORT, 'voucher identity is frozen'); END;
