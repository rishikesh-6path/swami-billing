-- Application settings (key/value). Domain tables arrive in later migrations.
CREATE TABLE setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
