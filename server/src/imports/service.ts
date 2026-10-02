import { normalizeReadings, type TemperatureUnit } from '../normalization/readings.js';
import {
  detectColumns,
  extractColumns,
  parseCsv,
  type ColumnDetection,
  type ColumnMapping,
  type CsvIssue,
} from '../parsing/index.js';
import type { Db } from '../persistence/db.js';
import { findOrCreateFridge, findReading, insertImport, insertReading } from '../persistence/repository.js';

/** Invalid upload input (missing metadata, file without data rows). */
export class ImportError extends Error {}

const SAMPLE_SIZE = 5;

export interface UploadPreview {
  headers: string[];
  detection: ColumnDetection;
  /** The mapping used for the counts below: the one supplied, else the detected one. Null when unresolved. */
  columns: ColumnMapping | null;
  issues: CsvIssue[];
  /** Data rows in the file (blank lines excluded). */
  rowCount: number;
  /** Null until the columns are resolved. */
  counts: { valid: number; invalid: number; rejected: number; duplicates: number; conflicts: number } | null;
  firstAt: string | null;
  lastAt: string | null;
  /** First few readings in time order, raw values as written. */
  sampleRows: { line: number; rawTimestamp: string; rawTemperature: string; recordedAt: string; invalidReason: string | null }[];
}

/**
 * Parses a file and reports what an import would contain. Writes nothing.
 * Counts only cover the file itself; matches against stored readings are
 * only known once the logger ID is supplied at import.
 */
export function previewUpload(content: string, columns?: ColumnMapping): UploadPreview {
  const parsed = parseCsv(content);
  const detection = detectColumns(parsed.headers);
  const mapping =
    columns ??
    (detection.confident ? { timestamp: detection.timestamp!, temperature: detection.temperature! } : null);

  const preview: UploadPreview = {
    headers: parsed.headers,
    detection,
    columns: mapping,
    issues: parsed.issues,
    rowCount: parsed.rows.length,
    counts: null,
    firstAt: null,
    lastAt: null,
    sampleRows: [],
  };
  if (!mapping) return preview;

  // The unit does not affect timestamps, validity or duplicate detection, and the
  // preview shows raw temperatures only, so 'C' here changes nothing visible.
  const result = normalizeReadings(extractColumns(parsed, mapping), 'C');
  const invalid = result.readings.filter((r) => r.temperatureC === null).length;
  preview.counts = {
    valid: result.readings.length - invalid,
    invalid,
    rejected: result.rejected.length,
    duplicates: result.duplicates.length,
    conflicts: result.conflicts.length,
  };
  preview.firstAt = result.readings[0]?.recordedAt ?? null;
  preview.lastAt = result.readings.at(-1)?.recordedAt ?? null;
  preview.sampleRows = result.readings
    .slice(0, SAMPLE_SIZE)
    .map(({ line, rawTimestamp, rawTemperature, recordedAt, invalidReason }) => ({
      line, rawTimestamp, rawTemperature, recordedAt, invalidReason,
    }));
  return preview;
}

export interface ImportInput {
  filename: string;
  content: string;
  columns: ColumnMapping;
  loggerId: string;
  branch: string;
  fridge: string;
  unit: TemperatureUnit;
}

/** A row from the file that was not stored, and why. */
export interface SkippedRow {
  line: number;
  rawTimestamp: string;
  rawTemperature: string;
  reason: string;
}

export interface ImportSummary {
  importId: number;
  fridgeId: number;
  counts: {
    rows: number;
    inserted: number;
    invalid: number;
    rejected: number;
    duplicates: number;
    conflicts: number;
  };
  rejected: SkippedRow[];
  conflicts: SkippedRow[];
}

/**
 * Imports a confirmed upload in one transaction (architecture §2.2):
 * find-or-create fridge → classify each reading against stored data →
 * insert the import record → insert new readings. Any failure stores nothing.
 */
export function importUpload(db: Db, input: ImportInput, now = new Date().toISOString()): ImportSummary {
  const loggerId = input.loggerId.trim();
  const branch = input.branch.trim();
  const fridge = input.fridge.trim();
  if (!loggerId || !branch || !fridge) {
    throw new ImportError('Logger ID, branch and fridge are required.');
  }

  const parsed = parseCsv(input.content);
  if (parsed.rows.length === 0) {
    throw new ImportError('The file has no data rows.');
  }
  const raw = extractColumns(parsed, input.columns);
  const result = normalizeReadings(raw, input.unit);

  const rejected: SkippedRow[] = result.rejected.map(({ line, rawTimestamp, rawTemperature, reason }) => ({
    line, rawTimestamp, rawTemperature, reason,
  }));
  const conflicts: SkippedRow[] = result.conflicts.map(({ line, rawTimestamp, rawTemperature, keptLine }) => ({
    line, rawTimestamp, rawTemperature,
    reason: `different value than line ${keptLine} at the same time in this file`,
  }));
  let duplicateCount = result.duplicates.length;

  return db.transaction((): ImportSummary => {
    const fridgeId = findOrCreateFridge(db, branch, fridge, now);

    // Same logger + timestamp already stored: same value → duplicate, otherwise → conflict (§5.3).
    const toInsert = result.readings.filter((r) => {
      const stored = findReading(db, loggerId, r.recordedAt);
      if (!stored) return true;
      if (stored.temperature_c === r.temperatureC) {
        duplicateCount++;
      } else {
        conflicts.push({
          line: r.line,
          rawTimestamp: r.rawTimestamp,
          rawTemperature: r.rawTemperature,
          reason: `already stored with a different value (import ${stored.import_id}, line ${stored.source_line})`,
        });
      }
      return false;
    });

    const counts = {
      rows: parsed.rows.length,
      inserted: toInsert.length,
      invalid: toInsert.filter((r) => r.temperatureC === null).length,
      rejected: rejected.length,
      duplicates: duplicateCount,
      conflicts: conflicts.length,
    };

    const importId = insertImport(db, {
      fridgeId,
      loggerId,
      unit: input.unit,
      filename: input.filename,
      timestampColumn: parsed.headers[input.columns.timestamp],
      temperatureColumn: parsed.headers[input.columns.temperature],
      rawContent: input.content,
      rowCount: counts.rows,
      insertedCount: counts.inserted,
      invalidCount: counts.invalid,
      rejectedCount: counts.rejected,
      duplicateCount: counts.duplicates,
      conflictCount: counts.conflicts,
      importedAt: now,
    });

    for (const r of toInsert) {
      insertReading(db, {
        importId,
        fridgeId,
        loggerId,
        sourceLine: r.line,
        recordedAt: r.recordedAt,
        rawTimestamp: r.rawTimestamp,
        rawTemperature: r.rawTemperature,
        temperatureC: r.temperatureC,
        invalidReason: r.invalidReason,
      });
    }

    return { importId, fridgeId, counts, rejected, conflicts };
  })();
}
