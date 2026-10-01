-- Place of supply and the party's GSTIN are frozen on the voucher when it is posted, so a
-- later change to the customer's master record cannot reclassify an old (possibly filed) invoice.
-- NULL on vouchers created before this migration; reports fall back to the party master for those.
ALTER TABLE voucher ADD COLUMN pos_state_code TEXT;
ALTER TABLE voucher ADD COLUMN party_gstin TEXT;
