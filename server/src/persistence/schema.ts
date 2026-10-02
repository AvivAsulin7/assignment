/**
 * SQLite schema (docs/architecture.md §5). Applied on every start with
 * CREATE ... IF NOT EXISTS — no migrations in the MVP.
 * Kept as a TypeScript string so the build needs no asset-copy step.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS fridges (
  id          INTEGER PRIMARY KEY,
  branch_name TEXT NOT NULL,   -- display spelling (first seen)
  name        TEXT NOT NULL,   -- display spelling (first seen)
  branch_key  TEXT NOT NULL,   -- toNameKey(branch_name)
  name_key    TEXT NOT NULL,   -- toNameKey(name)
  created_at  TEXT NOT NULL,
  UNIQUE (branch_key, name_key)
);

-- One row per confirmed upload. Holds the logger -> fridge assignment at import time.
-- row_count = inserted_count + rejected_count + duplicate_count + conflict_count;
-- invalid_count is the part of inserted_count whose temperature is invalid (e.g. ERR).
CREATE TABLE IF NOT EXISTS imports (
  id                 INTEGER PRIMARY KEY,
  fridge_id          INTEGER NOT NULL REFERENCES fridges(id),
  logger_id          TEXT NOT NULL,
  unit               TEXT NOT NULL CHECK (unit IN ('C', 'F')),
  filename           TEXT NOT NULL,
  timestamp_column   TEXT NOT NULL,  -- header text of the selected column
  temperature_column TEXT NOT NULL,
  raw_content        TEXT NOT NULL,  -- the original CSV, verbatim
  row_count          INTEGER NOT NULL,
  inserted_count     INTEGER NOT NULL,
  invalid_count      INTEGER NOT NULL,
  rejected_count     INTEGER NOT NULL,
  duplicate_count    INTEGER NOT NULL,
  conflict_count     INTEGER NOT NULL,
  imported_at        TEXT NOT NULL
);

-- fridge_id and logger_id are copied from the import and never change, so a
-- logger moving to another fridge never rewrites earlier readings.
CREATE TABLE IF NOT EXISTS readings (
  id              INTEGER PRIMARY KEY,
  import_id       INTEGER NOT NULL REFERENCES imports(id),
  fridge_id       INTEGER NOT NULL REFERENCES fridges(id),
  logger_id       TEXT NOT NULL,
  source_line     INTEGER NOT NULL,  -- line number in imports.raw_content
  recorded_at     TEXT NOT NULL,     -- local time 'YYYY-MM-DD HH:MM:SS'
  raw_timestamp   TEXT NOT NULL,
  raw_temperature TEXT NOT NULL,
  temperature_c   REAL,              -- NULL when invalid
  is_valid        INTEGER NOT NULL CHECK (is_valid IN (0, 1)),
  invalid_reason  TEXT,
  CHECK ((is_valid = 1 AND temperature_c IS NOT NULL AND invalid_reason IS NULL)
      OR (is_valid = 0 AND temperature_c IS NULL AND invalid_reason IS NOT NULL)),
  -- MVP assumption: one physical logger produces at most one reading per timestamp.
  UNIQUE (logger_id, recorded_at)
);
`;
