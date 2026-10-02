import { describe, expect, it } from 'vitest';
import { analyzeFridge, analyzeImport, type AnalysisReading } from '../../src/analysis/analyze.js';
import { THRESHOLD_C, WARMING_MIN_INCREASES, WARMING_MIN_RISE_C } from '../../src/analysis/rules.js';

let nextId = 1;

/** One reading at an explicit local time. */
const at = (importId: number, recordedAt: string, temperatureC: number | null): AnalysisReading => ({
  id: nextId++,
  importId,
  recordedAt,
  temperatureC,
});

/** Readings every `step` minutes from `start` ('YYYY-MM-DD HH:MM'). null = invalid (ERR). */
function series(importId: number, start: string, temps: (number | null)[], step = 15): AnalysisReading[] {
  const t0 = Date.parse(`${start.replace(' ', 'T')}:00Z`);
  return temps.map((t, i) => {
    const iso = new Date(t0 + i * step * 60_000).toISOString();
    return at(importId, `${iso.slice(0, 10)} ${iso.slice(11, 19)}`, t);
  });
}

/** Analyses readings that all belong to import 1. */
const one = (readings: AnalysisReading[]) => analyzeImport(1, readings);

describe('rules', () => {
  it('uses the documented thresholds', () => {
    expect(THRESHOLD_C).toBe(5.0);
    expect(WARMING_MIN_INCREASES).toBe(3);
    expect(WARMING_MIN_RISE_C).toBe(1.0);
  });
});

describe('threshold (A15)', () => {
  it('treats exactly 5.0 °C as in range', () => {
    const a = one(series(1, '2026-09-14 06:00', [4.0, 5.0, 5.0, 4.0]));
    expect(a.excursions).toEqual([]);
    expect(a.spikes).toEqual([]);
  });

  it('treats anything above 5.0 °C as above threshold', () => {
    expect(one(series(1, '2026-09-14 06:00', [4.0, 5.01, 4.0])).spikes).toHaveLength(1);
    expect(one(series(1, '2026-09-14 06:00', [4.0, 5.1, 5.1, 4.0])).excursions).toHaveLength(1);
  });
});

describe('isolated spike (A19)', () => {
  it('classifies Tel Aviv 4.1 → 9.4 → 4.3 as a spike, not an excursion', () => {
    const readings = series(1, '2026-09-14 05:45', [4.0, 4.1, 9.4, 4.3]);
    const a = one(readings);
    expect(a.spikes).toEqual([{ readingId: readings[2].id, at: '2026-09-14 06:15:00', temperatureC: 9.4 }]);
    expect(a.excursions).toEqual([]);
  });

  it('treats a high reading at the beginning of the import as an excursion', () => {
    const a = one(series(1, '2026-09-14 06:00', [6.0, 4.0, 4.0]));
    expect(a.spikes).toEqual([]);
    expect(a.excursions).toMatchObject([{ startAt: '2026-09-14 06:00:00', endAt: '2026-09-14 06:15:00', ongoing: false }]);
  });

  it('treats a high reading at the end of the import as an ongoing excursion', () => {
    const a = one(series(1, '2026-09-14 06:00', [4.0, 4.0, 6.0]));
    expect(a.spikes).toEqual([]);
    expect(a.excursions).toMatchObject([{ startAt: '2026-09-14 06:30:00', endAt: null, ongoing: true }]);
  });

  it('treats a high reading next to an invalid reading as an excursion', () => {
    expect(one(series(1, '2026-09-14 06:00', [4.0, null, 6.0, 4.0])).excursions).toHaveLength(1);
    expect(one(series(1, '2026-09-14 06:00', [4.0, 6.0, null, 4.0])).excursions).toHaveLength(1);
  });

  it('treats a high reading next to a gap as an excursion', () => {
    const readings = [
      ...series(1, '2026-09-14 06:00', [4.0, 4.0, 4.0, 4.0]),
      ...series(1, '2026-09-14 09:00', [6.0, 4.0, 4.0]),
    ];
    const a = one(readings);
    expect(a.gaps).toHaveLength(1);
    expect(a.spikes).toEqual([]);
    expect(a.excursions).toMatchObject([{ startAt: '2026-09-14 09:00:00', containsMissingData: false }]);
  });
});

describe('excursions (A20)', () => {
  it('reports start, end, duration, peak and readings', () => {
    const readings = series(1, '2026-09-14 06:00', [4.0, 6.0, 7.5, 6.5, 4.5, 4.0]);
    expect(one(readings).excursions).toEqual([
      {
        startAt: '2026-09-14 06:15:00',
        endAt: '2026-09-14 07:00:00',
        minutes: 45,
        ongoing: false,
        containsMissingData: false,
        peakC: 7.5,
        readingIds: readings.slice(1, 5).map((r) => r.id),
      },
    ]);
  });

  it('reports an ongoing excursion with an "at least" duration up to the last reading (Rishon)', () => {
    const a = one(series(1, '2026-09-14 06:00', [4.6, 5.4, 6.3, 7.1]));
    expect(a.excursions).toMatchObject([
      { startAt: '2026-09-14 06:15:00', endAt: null, minutes: 30, ongoing: true, peakC: 7.1 },
    ]);
  });

  it('keeps one excursion across an invalid reading and flags missing data', () => {
    const a = one(series(1, '2026-09-14 06:00', [4.0, 6.0, null, 7.0, 4.0]));
    expect(a.excursions).toMatchObject([
      { startAt: '2026-09-14 06:15:00', endAt: '2026-09-14 07:00:00', minutes: 45, containsMissingData: true, peakC: 7.0 },
    ]);
  });

  it('flags missing data when a gap falls inside the excursion', () => {
    const readings = [
      ...series(1, '2026-09-14 06:00', [4.0, 4.0, 4.0, 6.0]),
      ...series(1, '2026-09-14 09:00', [7.0, 4.0]),
    ];
    expect(one(readings).excursions).toMatchObject([
      { startAt: '2026-09-14 06:45:00', endAt: '2026-09-14 09:15:00', containsMissingData: true },
    ]);
  });

  it('does not treat an invalid reading as the end of an excursion', () => {
    const a = one(series(1, '2026-09-14 06:00', [6.0, 6.5, null]));
    expect(a.excursions).toMatchObject([{ ongoing: true, containsMissingData: true }]);
  });
});

describe('gaps (A16, A17)', () => {
  it('finds the Jerusalem 06:15 → 08:30 gap at a 15-minute interval', () => {
    const readings = [
      at(1, '2026-09-14 06:00:00', 3.8),
      at(1, '2026-09-14 06:15:00', 3.9),
      at(1, '2026-09-14 08:30:00', 4.0),
      at(1, '2026-09-14 08:45:00', 3.9),
    ];
    const a = one(readings);
    expect(a.expectedIntervalMinutes).toBe(15);
    expect(a.gaps).toEqual([
      { startAt: '2026-09-14 06:15:00', endAt: '2026-09-14 08:30:00', minutes: 135, readingIds: [readings[1].id, readings[2].id] },
    ]);
  });

  it('does not call exactly 2 × the interval a gap', () => {
    const readings = [...series(1, '2026-09-14 06:00', [4, 4, 4]), at(1, '2026-09-14 07:00:00', 4)];
    expect(one(readings).gaps).toEqual([]);
  });

  it('counts ERR readings as recorded timestamps for spacing', () => {
    const a = one(series(1, '2026-09-14 06:00', [4.0, null, null, 4.0]));
    expect(a.expectedIntervalMinutes).toBe(15);
    expect(a.gaps).toEqual([]);
  });

  it('has no interval and no gaps for a single-reading import', () => {
    const a = one([at(1, '2026-09-14 06:00:00', 4.0)]);
    expect(a.expectedIntervalMinutes).toBeNull();
    expect(a.gaps).toEqual([]);
  });
});

describe('gradual warming (A21, D2, O4)', () => {
  it('detects Rishon 4.6 → 5.4 → 6.3 → 7.1 as warming', () => {
    const readings = series(1, '2026-09-14 06:00', [4.6, 5.4, 6.3, 7.1]);
    expect(one(readings).warming).toEqual([
      {
        startAt: '2026-09-14 06:00:00',
        endAt: '2026-09-14 06:45:00',
        fromC: 4.6,
        toC: 7.1,
        riseC: 2.5,
        readingIds: readings.map((r) => r.id),
      },
    ]);
  });

  it('detects warming that never crosses 5 °C', () => {
    expect(one(series(1, '2026-09-14 06:00', [2.0, 2.5, 3.1, 3.6])).warming).toHaveLength(1);
  });

  it('does not flag 3 increases totalling less than 1.0 °C', () => {
    expect(one(series(1, '2026-09-14 06:00', [3.0, 3.2, 3.4, 3.6])).warming).toEqual([]);
  });

  it('counts a rise of exactly 1.0 °C despite floating-point noise (4.6 − 3.6)', () => {
    expect(4.6 - 3.6).toBeLessThan(1.0); // 0.9999999999999996 in floating point
    expect(one(series(1, '2026-09-14 06:00', [3.6, 3.9, 4.2, 4.6])).warming).toMatchObject([{ riseC: 1.0 }]);
  });

  it('does not flag only 2 increases, however large', () => {
    expect(one(series(1, '2026-09-14 06:00', [2.0, 4.0, 6.0])).warming).toEqual([]);
  });

  it('does not flag a single door-opening jump', () => {
    expect(one(series(1, '2026-09-14 06:00', [4.0, 4.1, 9.4, 4.3])).warming).toEqual([]);
  });

  it('breaks the sequence on an unchanged reading', () => {
    expect(one(series(1, '2026-09-14 06:00', [3.0, 3.5, 3.5, 4.0, 4.5])).warming).toEqual([]);
  });

  it('breaks the sequence on an invalid reading (ERR)', () => {
    expect(one(series(1, '2026-09-14 06:00', [3.0, 3.5, 4.0, 4.5])).warming).toHaveLength(1);
    expect(one(series(1, '2026-09-14 06:00', [3.0, 3.5, null, 4.0, 4.5])).warming).toEqual([]);
  });

  it('breaks the sequence on a gap', () => {
    const readings = [
      ...series(1, '2026-09-14 06:00', [3.0, 3.0, 3.0, 3.5]),
      ...series(1, '2026-09-14 09:00', [4.0, 4.5]),
    ];
    const a = one(readings);
    expect(a.gaps).toHaveLength(1);
    expect(a.warming).toEqual([]);
  });

  it('reports the whole rising run once', () => {
    expect(one(series(1, '2026-09-14 06:00', [2.0, 2.5, 3.0, 3.5, 4.0, 4.5])).warming).toMatchObject([
      { fromC: 2.0, toC: 4.5, riseC: 2.5 },
    ]);
  });
});

describe('import boundaries (D1, O3)', () => {
  it('creates no gap between separate imports', () => {
    const readings = [
      ...series(1, '2026-09-14 06:00', [4.0, 4.0, 4.0]),
      ...series(2, '2026-09-21 06:00', [4.0, 4.0, 4.0]),
    ];
    const f = analyzeFridge(readings);
    expect(f.imports.flatMap((i) => i.gaps)).toEqual([]);
  });

  it('never joins an excursion across imports', () => {
    const f = analyzeFridge([
      ...series(1, '2026-09-14 06:00', [4.0, 4.0, 6.0]),
      ...series(2, '2026-09-14 06:45', [6.5, 4.0, 4.0]),
    ]);
    expect(f.imports[0].excursions).toMatchObject([{ startAt: '2026-09-14 06:30:00', ongoing: true }]);
    expect(f.imports[1].excursions).toMatchObject([{ startAt: '2026-09-14 06:45:00', endAt: '2026-09-14 07:00:00' }]);
  });

  it('does not use a neighbour from another import to confirm a spike', () => {
    const f = analyzeFridge([
      ...series(1, '2026-09-14 06:00', [4.0, 4.0]),
      ...series(2, '2026-09-14 06:30', [9.0, 4.0]),
    ]);
    expect(f.imports[1].spikes).toEqual([]);
    expect(f.imports[1].excursions).toHaveLength(1);
  });

  it('never joins a warming sequence across imports', () => {
    const f = analyzeFridge([
      ...series(1, '2026-09-14 06:00', [3.0, 3.5]),
      ...series(2, '2026-09-14 06:30', [4.0, 4.5]),
    ]);
    expect(f.imports.flatMap((i) => i.warming)).toEqual([]);
  });

  it('computes the expected interval per import', () => {
    const f = analyzeFridge([
      ...series(1, '2026-09-14 06:00', [4, 4, 4], 15),
      ...series(2, '2026-09-21 06:00', [4, 4, 4], 5),
    ]);
    expect(f.imports.map((i) => i.expectedIntervalMinutes)).toEqual([15, 5]);
  });
});

describe('fridge status (A22, D3, O1, O2)', () => {
  it('is Excursion when the latest import had an excursion, even after recovery (O1)', () => {
    const f = analyzeFridge(series(1, '2026-09-14 06:00', [4.0, 6.0, 7.0, 4.0, 4.0]));
    expect(f.imports[0].excursions).toMatchObject([{ ongoing: false }]);
    expect(f.status).toBe('excursion');
  });

  it('uses only the latest import — an older excursion stays in history but not in status (D3)', () => {
    const f = analyzeFridge([
      ...series(1, '2026-09-14 06:00', [4.0, 6.0, 7.0]),
      ...series(2, '2026-09-21 06:00', [4.0, 4.0, 4.0]),
    ]);
    expect(f.status).toBe('ok');
    expect(f.statusImportId).toBe(2);
    expect(f.imports[0].excursions).toHaveLength(1);
  });

  it('picks the latest import by reading time, not import order (O2)', () => {
    const f = analyzeFridge([
      ...series(5, '2026-09-14 06:00', [4.0, 6.0, 7.0]), // uploaded later, older data
      ...series(4, '2026-09-21 06:00', [4.0, 4.0, 4.0]),
    ]);
    expect(f.statusImportId).toBe(4);
    expect(f.status).toBe('ok');
  });

  it('ranks Excursion > Warming > Data gaps > OK, and does not alarm on spikes', () => {
    expect(analyzeFridge(series(1, '2026-09-14 06:00', [4.6, 5.4, 6.3, 7.1])).status).toBe('excursion');
    expect(analyzeFridge(series(1, '2026-09-14 06:00', [2.0, 2.5, 3.1, 3.6])).status).toBe('warming');
    expect(
      analyzeFridge([...series(1, '2026-09-14 06:00', [4, 4, 4]), at(1, '2026-09-14 09:00:00', 4)]).status,
    ).toBe('gaps');
    expect(analyzeFridge(series(1, '2026-09-14 06:00', [4.0, 4.1, 9.4, 4.3])).status).toBe('ok');
  });

  it('has no status for a fridge without readings', () => {
    expect(analyzeFridge([])).toEqual({ imports: [], status: null, statusImportId: null });
  });
});

describe('purity', () => {
  it('does not modify or reorder the source readings', () => {
    const readings = [
      ...series(2, '2026-09-21 06:00', [4.0, null, 6.0]),
      ...series(1, '2026-09-14 06:00', [4.6, 5.4, 6.3, 7.1]),
    ].reverse();
    const before = structuredClone(readings);
    Object.freeze(readings);
    readings.forEach((r) => Object.freeze(r));
    analyzeFridge(readings);
    expect(readings).toEqual(before);
  });

  it('returns the same result for the same input', () => {
    const readings = series(1, '2026-09-14 06:00', [4.0, 6.0, null, 4.0, 3.0, 3.5, 4.0, 4.6]);
    expect(analyzeFridge(readings)).toEqual(analyzeFridge(readings));
  });
});
