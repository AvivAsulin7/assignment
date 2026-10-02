import { GAP_INTERVAL_MULTIPLIER, THRESHOLD_C, WARMING_MIN_INCREASES, WARMING_MIN_RISE_C } from './rules.js';

/**
 * Pure, deterministic temperature analysis (docs/architecture.md §7).
 * No database, HTTP or clock. Input readings are never modified.
 * Each import is analysed on its own (O3): no rule looks across an import boundary.
 */

/** A stored reading, normalized to °C. */
export interface AnalysisReading {
  id: number;
  importId: number;
  /** Local time 'YYYY-MM-DD HH:MM:SS'. */
  recordedAt: string;
  /** Null when the reading is invalid (e.g. ERR) — treated as missing data. */
  temperatureC: number | null;
}

export interface Gap {
  startAt: string;
  endAt: string;
  minutes: number;
  /** The two readings either side of the gap. */
  readingIds: [number, number];
}

export interface Spike {
  readingId: number;
  at: string;
  temperatureC: number;
}

export interface Excursion {
  startAt: string;
  /** First valid reading back at ≤ 5.0 °C; null while ongoing. */
  endAt: string | null;
  /** End − start; when ongoing, "at least" this long (start → last reading of the import). */
  minutes: number;
  ongoing: boolean;
  /** A gap or invalid reading falls inside the excursion, so the duration is uncertain. */
  containsMissingData: boolean;
  peakC: number;
  /** From the first reading above 5 °C up to and including the reading that ends it. */
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
  /** Median spacing between the import's readings (A16); null with fewer than 2 readings. */
  expectedIntervalMinutes: number | null;
  gaps: Gap[];
  spikes: Spike[];
  excursions: Excursion[];
  warming: Warming[];
}

export type FridgeStatus = 'excursion' | 'warming' | 'gaps' | 'ok';

export interface FridgeAnalysis {
  /** One entry per import that has stored readings, oldest data first. All history stays visible. */
  imports: ImportAnalysis[];
  /** Current status from the status import (D3, O1, O2); null when the fridge has no readings. */
  status: FridgeStatus | null;
  statusImportId: number | null;
}

const toMs = (at: string) => Date.parse(`${at.replace(' ', 'T')}Z`);
const minutesBetween = (from: string, to: string) => (toMs(to) - toMs(from)) / 60_000;
/** Rounds to 0.01 so floating-point noise (4.6 − 3.6 = 0.9999…) cannot decide a threshold. */
const round2 = (x: number) => Math.round(x * 100) / 100;

const isHigh = (r: AnalysisReading) => r.temperatureC !== null && r.temperatureC > THRESHOLD_C;
const isInRange = (r: AnalysisReading) => r.temperatureC !== null && r.temperatureC <= THRESHOLD_C;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Analyses the readings of ONE import, sorted by time. */
export function analyzeImport(importId: number, readings: AnalysisReading[]): ImportAnalysis {
  const r = readings;
  const n = r.length;

  // A16 / A17: every stored reading counts for spacing — an ERR reading still has a timestamp.
  const spacing = r.slice(1).map((reading, i) => minutesBetween(r[i].recordedAt, reading.recordedAt));
  const expectedIntervalMinutes = median(spacing);
  /** gapAfter[i]: the spacing between reading i and i + 1 is a gap. */
  const gapAfter = spacing.map(
    (m) => expectedIntervalMinutes !== null && m > GAP_INTERVAL_MULTIPLIER * expectedIntervalMinutes,
  );

  const gaps: Gap[] = [];
  gapAfter.forEach((isGap, i) => {
    if (isGap) {
      gaps.push({
        startAt: r[i].recordedAt,
        endAt: r[i + 1].recordedAt,
        minutes: spacing[i],
        readingIds: [r[i].id, r[i + 1].id],
      });
    }
  });

  // A19 / A20: isolated spikes and excursions.
  const spikes: Spike[] = [];
  const excursions: Excursion[] = [];
  let i = 0;
  while (i < n) {
    if (!isHigh(r[i])) {
      i++;
      continue;
    }

    const isolated =
      i > 0 && i < n - 1 && isInRange(r[i - 1]) && isInRange(r[i + 1]) && !gapAfter[i - 1] && !gapAfter[i];
    if (isolated) {
      spikes.push({ readingId: r[i].id, at: r[i].recordedAt, temperatureC: r[i].temperatureC! });
      i++;
      continue;
    }

    // Excursion: from this reading until the first valid reading ≤ 5.0 °C in the same import.
    const start = i;
    let end = i + 1;
    while (end < n && !isInRange(r[end])) end++;
    const ongoing = end === n;
    const last = ongoing ? n - 1 : end;

    let containsMissingData = false;
    let peakC = -Infinity;
    for (let k = start; k <= last; k++) {
      if (k < last && gapAfter[k]) containsMissingData = true;
      if (k > start && k < end && r[k].temperatureC === null) containsMissingData = true;
      if (k < end && r[k].temperatureC !== null) peakC = Math.max(peakC, r[k].temperatureC!);
    }

    excursions.push({
      startAt: r[start].recordedAt,
      endAt: ongoing ? null : r[end].recordedAt,
      minutes: minutesBetween(r[start].recordedAt, r[last].recordedAt),
      ongoing,
      containsMissingData,
      peakC,
      readingIds: r.slice(start, last + 1).map((x) => x.id),
    });
    i = end;
  }

  // A21 / D2 / O4: consecutive valid readings, each warmer than the one before, no gap between.
  // An isolated spike (one-reading door jump) is not part of a trend: it ends the sequence.
  const spikeIds = new Set(spikes.map((s) => s.readingId));
  const warming: Warming[] = [];
  let runStart = 0;
  for (let k = 1; k <= n; k++) {
    const continues =
      k < n &&
      r[k - 1].temperatureC !== null &&
      r[k].temperatureC !== null &&
      !spikeIds.has(r[k - 1].id) &&
      !spikeIds.has(r[k].id) &&
      !gapAfter[k - 1] &&
      r[k].temperatureC! > r[k - 1].temperatureC!;
    if (continues) continue;

    const increases = k - 1 - runStart;
    if (increases >= WARMING_MIN_INCREASES) {
      const first = r[runStart];
      const lastReading = r[k - 1];
      const riseC = round2(lastReading.temperatureC! - first.temperatureC!);
      if (riseC >= WARMING_MIN_RISE_C) {
        warming.push({
          startAt: first.recordedAt,
          endAt: lastReading.recordedAt,
          fromC: first.temperatureC!,
          toC: lastReading.temperatureC!,
          riseC,
          readingIds: r.slice(runStart, k).map((x) => x.id),
        });
      }
    }
    runStart = k;
  }

  return {
    importId,
    firstAt: r[0].recordedAt,
    lastAt: r[n - 1].recordedAt,
    expectedIntervalMinutes,
    gaps,
    spikes,
    excursions,
    warming,
  };
}

/** Status of one import, by priority Excursion > Warming > Data gaps > OK (A22). Spikes are not alarmed (A19). */
function importStatus(a: ImportAnalysis): FridgeStatus {
  if (a.excursions.length > 0) return 'excursion'; // O1: a recovered excursion still counts.
  if (a.warming.length > 0) return 'warming';
  if (a.gaps.length > 0) return 'gaps';
  return 'ok';
}

/**
 * Analyses all stored readings of one fridge. Readings are grouped by import and
 * each import is analysed independently (O3). The current status comes from the
 * import whose readings end latest (D3, O2) — only imports with stored readings
 * exist here, so a re-upload that added nothing never changes the status.
 */
export function analyzeFridge(readings: readonly AnalysisReading[]): FridgeAnalysis {
  const byImport = new Map<number, AnalysisReading[]>();
  for (const reading of readings) {
    const list = byImport.get(reading.importId) ?? [];
    list.push(reading);
    byImport.set(reading.importId, list);
  }

  const imports = [...byImport.entries()]
    .map(([importId, list]) =>
      analyzeImport(importId, [...list].sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : 1))),
    )
    .sort((a, b) => (a.firstAt < b.firstAt ? -1 : a.firstAt > b.firstAt ? 1 : a.importId - b.importId));

  let statusImport: ImportAnalysis | null = null;
  for (const a of imports) {
    if (
      !statusImport ||
      a.lastAt > statusImport.lastAt ||
      (a.lastAt === statusImport.lastAt && a.importId > statusImport.importId)
    ) {
      statusImport = a;
    }
  }

  return {
    imports,
    status: statusImport ? importStatus(statusImport) : null,
    statusImportId: statusImport?.importId ?? null,
  };
}
