-- Minimal system chart of accounts and units. Busy's own groups/accounts are imported on
-- top of these (matched by name) in Phase 1.
INSERT INTO account_group (id, name, parent_id, nature, is_system) VALUES
  (1,  'Capital Account',      NULL, 'liability', 1),
  (2,  'Current Assets',       NULL, 'asset',     1),
  (3,  'Current Liabilities',  NULL, 'liability', 1),
  (4,  'Sales Accounts',       NULL, 'income',    1),
  (5,  'Purchase Accounts',    NULL, 'expense',   1),
  (6,  'Direct Incomes',       NULL, 'income',    1),
  (7,  'Direct Expenses',      NULL, 'expense',   1),
  (8,  'Indirect Incomes',     NULL, 'income',    1),
  (9,  'Indirect Expenses',    NULL, 'expense',   1),
  (10, 'Cash-in-Hand',         2,    'asset',     1),
  (11, 'Bank Accounts',        2,    'asset',     1),
  (12, 'Sundry Debtors',       2,    'asset',     1),
  (13, 'Stock-in-Hand',        2,    'asset',     1),
  (14, 'Sundry Creditors',     3,    'liability', 1),
  (15, 'Duties & Taxes',       3,    'liability', 1);

INSERT INTO account (id, name, group_id, is_system) VALUES
  (1, 'Cash',          10, 1),
  (2, 'Sales',          4, 1),
  (3, 'Purchase',       5, 1),
  (4, 'Output CGST',   15, 1),
  (5, 'Output SGST',   15, 1),
  (6, 'Output IGST',   15, 1),
  (7, 'Input CGST',    15, 1),
  (8, 'Input SGST',    15, 1),
  (9, 'Input IGST',    15, 1),
  (10, 'Round Off',     9, 1);

INSERT INTO unit (id, name, decimals) VALUES
  (1, 'Pcs',   0),
  (2, 'Metre', 3);
