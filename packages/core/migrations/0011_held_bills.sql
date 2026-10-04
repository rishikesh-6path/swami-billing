-- A bill set aside while the counter serves someone else. It is a draft only: no bill number, no
-- ledger lines and no stock effect until it is taken back and saved as a real bill.
CREATE TABLE held_bill (
  id           INTEGER PRIMARY KEY,
  kind         TEXT NOT NULL,
  user_id      INTEGER NOT NULL REFERENCES user (id),
  label        TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at   TEXT NOT NULL
) STRICT;
CREATE INDEX held_bill_user_idx ON held_bill (user_id, created_at);
