-- voucher_item had no index on item_id, so every per-item lookup (last purchase, last price for a
-- customer, item history) read the whole table. At tens of thousands of bills the "Items to Order"
-- list took many seconds. Plain indexes only; no data or rules change.
CREATE INDEX voucher_item_item_idx ON voucher_item (item_id, voucher_id);
CREATE INDEX voucher_type_status_date_idx ON voucher (voucher_type, status, date);
