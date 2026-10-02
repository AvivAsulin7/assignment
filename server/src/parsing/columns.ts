import { toNameKey } from '../domain/names.js';
import type { ParsedCsv } from './csv.js';

/**
 * Header aliases (requirements A2). Matching ignores case, surrounding/extra
 * whitespace and a trailing bracketed suffix such as "(°C)" or "[F]".
 * The suffix is only ignored for matching — the unit is always chosen by the
 * user at upload, never read from the header (A9).
 */
export const TIMESTAMP_ALIASES = ['time', 'timestamp', 'datetime', 'date time', 'date/time', 'date'];
// "value" is deliberately excluded: too generic, it risks a false automatic match.
// An unresolved column (user chooses) is preferred over a wrong guess.
export const TEMPERATURE_ALIASES = ['temp', 'temperature'];

/** Columns are identified by zero-based index, since header names may repeat or be blank. */
export interface ColumnMapping {
  timestamp: number;
  temperature: number;
}

export interface ColumnDetection {
  /** Resolved column index, or null when it must be chosen by the user. */
  timestamp: number | null;
  temperature: number | null;
  /** True only when both columns were resolved from headers. */
  confident: boolean;
  /** Every column whose header matched each role (more than one → ambiguous → unresolved). */
  matches: { timestamp: number[]; temperature: number[] };
}

/** One data row reduced to the two selected columns, still raw strings. */
export interface RawReading {
  line: number;
  rawTimestamp: string;
  rawTemperature: string;
}

export class ColumnMappingError extends Error {}

function headerKey(header: string): string {
  return toNameKey(header)
    .replace(/\s*[([][^)\]]*[)\]]$/, '')
    .trim();
}

function matchingColumns(headers: string[], aliases: string[]): number[] {
  return headers.flatMap((header, index) => (aliases.includes(headerKey(header)) ? [index] : []));
}

/**
 * Identifies the timestamp and temperature columns from header names only.
 * Cell contents are never inspected. A role is resolved only when exactly one
 * header matches it; otherwise it is left null for the user to choose.
 */
export function detectColumns(headers: string[]): ColumnDetection {
  const matches = {
    timestamp: matchingColumns(headers, TIMESTAMP_ALIASES),
    temperature: matchingColumns(headers, TEMPERATURE_ALIASES),
  };
  const timestamp = matches.timestamp.length === 1 ? matches.timestamp[0] : null;
  const temperature = matches.temperature.length === 1 ? matches.temperature[0] : null;
  return {
    timestamp,
    temperature,
    confident: timestamp !== null && temperature !== null,
    matches,
  };
}

/**
 * Applies a column mapping (detected or chosen by the user) and returns the two
 * selected cells of every row as raw strings. A cell missing from a short row
 * is returned as ''. Throws ColumnMappingError for an invalid mapping.
 */
export function extractColumns(parsed: ParsedCsv, mapping: ColumnMapping): RawReading[] {
  const columnCount = parsed.headers.length;
  for (const [role, index] of Object.entries(mapping)) {
    if (!Number.isInteger(index) || index < 0 || index >= columnCount) {
      throw new ColumnMappingError(`The ${role} column (${index}) does not exist in this file.`);
    }
  }
  if (mapping.timestamp === mapping.temperature) {
    throw new ColumnMappingError('The timestamp and temperature columns must be different.');
  }

  return parsed.rows.map((row) => ({
    line: row.line,
    rawTimestamp: row.cells[mapping.timestamp] ?? '',
    rawTemperature: row.cells[mapping.temperature] ?? '',
  }));
}
