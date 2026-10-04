-- How much a customer may owe the shop at most. 0 means no limit.
ALTER TABLE account ADD COLUMN credit_limit_paise INTEGER NOT NULL DEFAULT 0 CHECK (credit_limit_paise >= 0);
