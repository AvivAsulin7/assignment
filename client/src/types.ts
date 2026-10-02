// Response shapes of the upload API (server/src/imports/service.ts).

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
