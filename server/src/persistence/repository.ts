import { toNameKey } from '../domain/names.js';
import type { Db } from './db.js';

/** Only the queries the import flow needs. Plain SQL, no business rules. */

/** Finds a fridge by normalized branch + fridge name, creating it on first use (A8). */
export function findOrCreateFridge(db: Db, branchName: string, name: string, now: string): number {
  const branchKey = toNameKey(branchName);
  const nameKey = toNameKey(name);
  const existing = db
    .prepare('SELECT id FROM fridges WHERE branch_key = ? AND name_key = ?')
    .get(branchKey, nameKey) as { id: number } | undefined;
  if (existing) return existing.id;

  // A new fridge in a known branch keeps the branch's first-seen spelling ("tel aviv" → "Tel Aviv").
  const knownBranch = db
    .prepare('SELECT branch_name FROM fridges WHERE branch_key = ? ORDER BY id LIMIT 1')
    .get(branchKey) as { branch_name: string } | undefined;
  if (knownBranch) branchName = knownBranch.branch_name;

  const result = db
    .prepare(
      `INSERT INTO fridges (branch_name, name, branch_key, name_key, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(branchName, name, branchKey, nameKey, now);
  return Number(result.lastInsertRowid);
}

/** The stored reading for a logger at a timestamp, if any. */
export function findReading(
  db: Db,
  loggerId: string,
  recordedAt: string,
): { temperature_c: number | null; source_line: number; import_id: number } | undefined {
  return db
    .prepare(
      'SELECT temperature_c, source_line, import_id FROM readings WHERE logger_id = ? AND recorded_at = ?',
    )
    .get(loggerId, recordedAt) as
    | { temperature_c: number | null; source_line: number; import_id: number }
    | undefined;
}

export interface NewImport {
  fridgeId: number;
  loggerId: string;
  unit: 'C' | 'F';
  filename: string;
  timestampColumn: string;
  temperatureColumn: string;
  rawContent: string;
  rowCount: number;
  insertedCount: number;
  invalidCount: number;
  rejectedCount: number;
  duplicateCount: number;
  conflictCount: number;
  importedAt: string;
}

export function insertImport(db: Db, imp: NewImport): number {
  const result = db
    .prepare(
      `INSERT INTO imports (fridge_id, logger_id, unit, filename, timestamp_column, temperature_column,
         raw_content, row_count, inserted_count, invalid_count, rejected_count, duplicate_count,
         conflict_count, imported_at)
       VALUES (@fridgeId, @loggerId, @unit, @filename, @timestampColumn, @temperatureColumn,
         @rawContent, @rowCount, @insertedCount, @invalidCount, @rejectedCount, @duplicateCount,
         @conflictCount, @importedAt)`,
    )
    .run(imp);
  return Number(result.lastInsertRowid);
}

export interface NewReading {
  importId: number;
  fridgeId: number;
  loggerId: string;
  sourceLine: number;
  recordedAt: string;
  rawTimestamp: string;
  rawTemperature: string;
  temperatureC: number | null;
  invalidReason: string | null;
}

export function insertReading(db: Db, r: NewReading): void {
  db.prepare(
    `INSERT INTO readings (import_id, fridge_id, logger_id, source_line, recorded_at, raw_timestamp,
       raw_temperature, temperature_c, is_valid, invalid_reason)
     VALUES (@importId, @fridgeId, @loggerId, @sourceLine, @recordedAt, @rawTimestamp,
       @rawTemperature, @temperatureC, @isValid, @invalidReason)`,
  ).run({ ...r, isValid: r.temperatureC === null ? 0 : 1 });
}
