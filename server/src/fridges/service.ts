import {
  analyzeFridge,
  type AnalysisReading,
  type FridgeStatus,
  type ImportAnalysis,
} from '../analysis/analyze.js';
import type { Db } from '../persistence/db.js';
import {
  findFridge,
  listFridgeImports,
  listFridgeReadings,
  listFridges,
  type FridgeRow,
  type ReadingRow,
} from '../persistence/repository.js';

/**
 * Read-side queries for the fridge endpoints: load stored data, run the
 * Phase 5 analysis on read, shape the result. No temperature rules here.
 */

const toAnalysisReading = (r: ReadingRow): AnalysisReading => ({
  id: r.id,
  importId: r.import_id,
  recordedAt: r.recorded_at,
  temperatureC: r.temperature_c,
});

export interface FridgeOverview {
  id: number;
  branch: string;
  name: string;
  /** Null when the fridge has no stored readings (shown as "No data" by the UI). */
  status: FridgeStatus | null;
  /** The most recent stored reading; temperatureC is null if it was invalid (e.g. ERR). */
  latestReading: { recordedAt: string; temperatureC: number | null } | null;
}

function overview(db: Db, fridge: FridgeRow): FridgeOverview {
  const readings = listFridgeReadings(db, fridge.id);
  const latest = readings.at(-1);
  return {
    id: fridge.id,
    branch: fridge.branch_name,
    name: fridge.name,
    status: analyzeFridge(readings.map(toAnalysisReading)).status,
    latestReading: latest ? { recordedAt: latest.recorded_at, temperatureC: latest.temperature_c } : null,
  };
}

export function listFridgeOverviews(db: Db): FridgeOverview[] {
  return listFridges(db).map((fridge) => overview(db, fridge));
}

export interface FridgeDetail {
  fridge: { id: number; branch: string; name: string };
  status: FridgeStatus | null;
  /** The import the current status was taken from (D3, O2). */
  statusImportId: number | null;
  /**
   * Every import of this fridge, oldest first, each with its own findings —
   * imports are analysed independently (O3). `analysis` is null for an import
   * that added no readings (e.g. a re-upload of duplicates).
   */
  imports: {
    id: number;
    loggerId: string;
    filename: string;
    unit: 'C' | 'F';
    importedAt: string;
    counts: { rows: number; inserted: number; invalid: number; rejected: number; duplicates: number; conflicts: number };
    analysis: ImportAnalysis | null;
  }[];
  /** All stored readings in time order, raw values kept for traceability. */
  readings: {
    id: number;
    importId: number;
    loggerId: string;
    sourceLine: number;
    recordedAt: string;
    rawTimestamp: string;
    rawTemperature: string;
    temperatureC: number | null;
    invalidReason: string | null;
  }[];
}

export function getFridgeDetail(db: Db, id: number): FridgeDetail | null {
  const fridge = findFridge(db, id);
  if (!fridge) return null;

  const readings = listFridgeReadings(db, id);
  const analysis = analyzeFridge(readings.map(toAnalysisReading));
  const byImport = new Map(analysis.imports.map((a) => [a.importId, a]));

  return {
    fridge: { id: fridge.id, branch: fridge.branch_name, name: fridge.name },
    status: analysis.status,
    statusImportId: analysis.statusImportId,
    imports: listFridgeImports(db, id).map((imp) => ({
      id: imp.id,
      loggerId: imp.logger_id,
      filename: imp.filename,
      unit: imp.unit,
      importedAt: imp.imported_at,
      counts: {
        rows: imp.row_count,
        inserted: imp.inserted_count,
        invalid: imp.invalid_count,
        rejected: imp.rejected_count,
        duplicates: imp.duplicate_count,
        conflicts: imp.conflict_count,
      },
      analysis: byImport.get(imp.id) ?? null,
    })),
    readings: readings.map((r) => ({
      id: r.id,
      importId: r.import_id,
      loggerId: r.logger_id,
      sourceLine: r.source_line,
      recordedAt: r.recorded_at,
      rawTimestamp: r.raw_timestamp,
      rawTemperature: r.raw_temperature,
      temperatureC: r.temperature_c,
      invalidReason: r.invalid_reason,
    })),
  };
}
