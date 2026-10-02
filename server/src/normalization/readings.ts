import type { RawReading } from '../parsing/index.js';

/** Temperature unit selected by the user at upload (requirements A9). */
export type TemperatureUnit = 'C' | 'F';

/** A reading with a usable timestamp. Raw text is kept next to normalized values (A11). */
export interface NormalizedReading {
  line: number;
  rawTimestamp: string;
  rawTemperature: string;
  /** Canonical local time 'YYYY-MM-DD HH:MM:SS' — no time-zone conversion (A4). */
  recordedAt: string;
  /** Celsius value, or null when the temperature is invalid (A12). */
  temperatureC: number | null;
  /** Why the temperature is invalid, or null when it is valid. */
  invalidReason: string | null;
}

/** A row whose timestamp cannot be parsed; it cannot be placed in time (A3). */
export interface RejectedRow {
  line: number;
  rawTimestamp: string;
  rawTemperature: string;
  reason: string;
}

/** A row with the same timestamp as an earlier row in the same file. */
export interface RepeatedRow {
  line: number;
  rawTimestamp: string;
  rawTemperature: string;
  /** Line of the earlier row that was kept. */
  keptLine: number;
}

export interface NormalizationResult {
  /** One reading per timestamp, sorted chronologically (A13). */
  readings: NormalizedReading[];
  rejected: RejectedRow[];
  /** Same timestamp and same value as an earlier row (A14). */
  duplicates: RepeatedRow[];
  /** Same timestamp but a different value than an earlier row (A14). */
  conflicts: RepeatedRow[];
}

const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const DMY_TIMESTAMP = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?$/;
const NUMBER = /^[+-]?\d+(\.\d+)?$/;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * Parses the two supported formats (A3) into canonical local time
 * 'YYYY-MM-DD HH:MM:SS'. Slash dates are always day/month. Returns null for
 * anything else, including impossible dates such as 31/02/2026.
 */
export function parseTimestamp(raw: string): string | null {
  const text = raw.trim();
  let year: number, month: number, day: number, hour: number, minute: number, second: number;

  const iso = ISO_TIMESTAMP.exec(text);
  const dmy = iso ? null : DMY_TIMESTAMP.exec(text);
  if (iso) {
    [year, month, day, hour, minute] = iso.slice(1, 6).map(Number);
    second = Number(iso[6] ?? 0);
  } else if (dmy) {
    [day, month, year, hour, minute] = dmy.slice(1, 6).map(Number);
    second = Number(dmy[6] ?? 0);
  } else {
    return null;
  }

  // Date.UTC rolls invalid values over (31 Feb → 3 Mar); reject if anything changed.
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute ||
    d.getUTCSeconds() !== second
  ) {
    return null;
  }
  return `${pad(year, 4)}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/** Parses a plain decimal number ("3.8", "-1", " 7.1 "). Anything else is invalid (A12). */
export function parseTemperature(raw: string): { value: number } | { invalidReason: string } {
  const text = raw.trim();
  if (text === '') return { invalidReason: 'empty value' };
  if (!NUMBER.test(text)) return { invalidReason: `non-numeric value: ${text}` };
  return { value: Number(text) };
}

/**
 * °C = (°F − 32) × 5/9 (A9), rounded to 2 decimals so floating-point noise
 * (e.g. 3.4999999…) cannot affect threshold comparisons.
 */
export function fahrenheitToCelsius(f: number): number {
  return Math.round(((f - 32) * 5) / 9 * 100) / 100;
}

/**
 * Normalizes the raw rows of one file for one logger, in the unit the user selected.
 * Every input row ends up in exactly one of: readings, rejected, duplicates, conflicts.
 * When two rows share a timestamp, the first one in the file is kept.
 */
export function normalizeReadings(rows: RawReading[], unit: TemperatureUnit): NormalizationResult {
  const result: NormalizationResult = { readings: [], rejected: [], duplicates: [], conflicts: [] };
  const byTimestamp = new Map<string, NormalizedReading>();

  for (const row of rows) {
    const { line, rawTimestamp, rawTemperature } = row;
    const recordedAt = parseTimestamp(rawTimestamp);
    if (recordedAt === null) {
      result.rejected.push({ line, rawTimestamp, rawTemperature, reason: 'unrecognised timestamp' });
      continue;
    }

    const parsed = parseTemperature(rawTemperature);
    let temperatureC: number | null = null;
    let invalidReason: string | null = null;
    if ('value' in parsed) {
      temperatureC = unit === 'F' ? fahrenheitToCelsius(parsed.value) : parsed.value;
    } else {
      invalidReason = parsed.invalidReason;
    }
    const reading: NormalizedReading = {
      line,
      rawTimestamp,
      rawTemperature,
      recordedAt,
      temperatureC,
      invalidReason,
    };

    const kept = byTimestamp.get(recordedAt);
    if (kept) {
      // Same value = both invalid, or both valid with the same number.
      const repeated = { line, rawTimestamp, rawTemperature, keptLine: kept.line };
      if (kept.temperatureC === reading.temperatureC) result.duplicates.push(repeated);
      else result.conflicts.push(repeated);
      continue;
    }
    byTimestamp.set(recordedAt, reading);
  }

  result.readings = [...byTimestamp.values()].sort((a, b) =>
    a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0,
  );
  return result;
}
