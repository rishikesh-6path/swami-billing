-- How GST was applied to an item bill (within the state, between states, or none) is kept on the
-- voucher, so a printed copy never has to guess it from amounts that may have rounded to nil.
-- NULL for entry vouchers (receipts, payments, journals) and for any bill made before this migration.
ALTER TABLE voucher ADD COLUMN tax_mode TEXT CHECK (tax_mode IN ('local', 'interstate', 'exempt'));
