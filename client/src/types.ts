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

// GET /api/fridges/:id — findings come from the server's analysis (server/src/analysis/analyze.ts).

export interface Gap {
  startAt: string;
  endAt: string;
  minutes: number;
  readingIds: [number, number];
}

export interface Spike {
  readingId: number;
  at: string;
  temperatureC: number;
}

export interface Excursion {
  startAt: string;
  /** Null while still above 5 °C at the end of its import. */
  endAt: string | null;
  /** When ongoing: "at least" this long. */
  minutes: number;
  ongoing: boolean;
  containsMissingData: boolean;
  peakC: number;
  readingIds: number[];
}

export interface Warming {
  startAt: string;
  endAt: string;
  fromC: number;
  toC: number;
  riseC: number;
  readingIds: number[];
}

export interface ImportAnalysis {
  importId: number;
  firstAt: string;
  lastAt: string;
  expectedIntervalMinutes: number | null;
  gaps: Gap[];
  spikes: Spike[];
  excursions: Excursion[];
  warming: Warming[];
}

export interface FridgeDetail {
  fridge: { id: number; branch: string; name: string };
  status: FridgeStatus | null;
  statusImportId: number | null;
  /** Oldest first; findings stay with the import they came from. */
  imports: {
    id: number;
    loggerId: string;
    filename: string;
    unit: Unit;
    importedAt: string;
    counts: ImportSummary['counts'];
    /** Null when the import added no readings. */
    analysis: ImportAnalysis | null;
  }[];
  /** All stored readings, oldest first. */
  readings: {
    id: number;
    importId: number;
    loggerId: string;
    sourceLine: number;
    recordedAt: string;
    rawTimestamp: string;
    rawTemperature: string;
    /** Null when the reading is invalid (e.g. ERR). */
    temperatureC: number | null;
    invalidReason: string | null;
  }[];
}
