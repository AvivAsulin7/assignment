// Response shapes of the API (server/src/imports/service.ts, server/src/fridges/service.ts).

/** Current status computed by the server's analysis; null when the fridge has no readings. */
export type FridgeStatus = 'excursion' | 'warming' | 'gaps' | 'ok';

/** GET /api/fridges item. */
export interface FridgeOverview {
  id: number;
  branch: string;
  name: string;
  status: FridgeStatus | null;
  /** The actual latest stored reading; temperatureC is null when that reading is invalid. */
  latestReading: { recordedAt: string; temperatureC: number | null } | null;
}

export type Unit = 'C' | 'F';

export interface ColumnMapping {
  timestamp: number;
  temperature: number;
}

export interface UploadPreview {
  headers: string[];
  detection: {
    timestamp: number | null;
    temperature: number | null;
    confident: boolean;
    matches: { timestamp: number[]; temperature: number[] };
  };
  columns: ColumnMapping | null;
  issues: { line: number | null; message: string }[];
  rowCount: number;
  counts: { valid: number; invalid: number; rejected: number; duplicates: number; conflicts: number } | null;
  firstAt: string | null;
  lastAt: string | null;
  sampleRows: {
    line: number;
    rawTimestamp: string;
    rawTemperature: string;
    recordedAt: string;
    invalidReason: string | null;
  }[];
}

export interface SkippedRow {
  line: number;
  rawTimestamp: string;
  rawTemperature: string;
  reason: string;
}

export interface ImportSummary {
  importId: number;
  fridgeId: number;
  counts: { rows: number; inserted: number; invalid: number; rejected: number; duplicates: number; conflicts: number };
  rejected: SkippedRow[];
  conflicts: SkippedRow[];
}
