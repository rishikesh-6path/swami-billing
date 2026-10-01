-- A reprint must look like the original. The shop's own details (name, address, GSTIN, footer),
-- the party's name, address, phone and state, and the item names are copied here when the voucher
-- is posted, so later edits to Settings or to the masters never change an old bill.
-- NULL for entry vouchers made before this migration; those fall back to the current details.
ALTER TABLE voucher ADD COLUMN snapshot_json TEXT;
