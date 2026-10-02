-- Name and alias checks compare lower-cased text. Without these indexes each check scans the whole
-- table, so importing thousands of items or parties took minutes. Plain (non-unique) indexes: the
-- existing unique rules are unchanged.
CREATE INDEX item_lower_name_idx ON item (lower(name));
CREATE INDEX item_lower_alias_idx ON item (lower(alias)) WHERE alias IS NOT NULL;
CREATE INDEX account_lower_name_idx ON account (lower(name));
