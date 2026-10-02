-- The supplier's own invoice number and date on a purchase bill. Needed to match the supplier's
-- GST filing (GSTR-2B), to find a bill, and to stop one supplier invoice being entered twice.
-- NULL for sales, entries and any bill made before this migration.
ALTER TABLE voucher ADD COLUMN party_bill_no TEXT;
ALTER TABLE voucher ADD COLUMN party_bill_date TEXT;
CREATE INDEX voucher_party_bill_idx ON voucher (party_account_id, party_bill_no) WHERE party_bill_no IS NOT NULL;
