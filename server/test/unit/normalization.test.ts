import { describe, expect, it } from 'vitest';
import {
  fahrenheitToCelsius,
  normalizeReadings,
  parseTemperature,
  parseTimestamp,
} from '../../src/normalization/readings.js';
import type { RawReading } from '../../src/parsing/index.js';

let nextLine = 2;
const raw = (rawTimestamp: string, rawTemperature: string): RawReading => ({
  line: nextLine++,
  rawTimestamp,
  rawTemperature,
});

describe('parseTimestamp', () => {
  it.each([
    ['2026-09-14 06:00', '2026-09-14 06:00:00'],
    ['2026-09-14T06:15', '2026-09-14 06:15:00'],
    ['2026-09-14 06:15:30', '2026-09-14 06:15:30'],
    [' 2026-09-14 06:00 ', '2026-09-14 06:00:00'],
  ])('parses ISO-style %j', (input, expected) => {
    expect(parseTimestamp(input)).toBe(expected);
  });

  it('parses DD/MM/YYYY (Haifa sample)', () => {
    expect(parseTimestamp('14/09/2026 06:00')).toBe('2026-09-14 06:00:00');
    expect(parseTimestamp('14/09/2026 06:30:15')).toBe('2026-09-14 06:30:15');
  });

  it('always reads slash dates as day/month', () => {
    expect(parseTimestamp('05/09/2026 06:00')).toBe('2026-09-05 06:00:00');
  });

  it.each(['31/02/2026 06:00', '2026-02-30 06:00', '2026-13-01 06:00', '2026-09-14 24:00', '2026-09-14 06:60'])(
    'rejects the impossible date/time %j',
    (input) => {
      expect(parseTimestamp(input)).toBeNull();
    },
  );

  it.each(['', 'ERR', '09/14/2026', '2026-09-14', '14.09.2026 06:00', '2026/09/14 06:00'])(
    'rejects the unsupported format %j',
    (input) => {
      expect(parseTimestamp(input)).toBeNull();
    },
  );
});

describe('parseTemperature', () => {
  it.each([
    ['3.8', 3.8],
    [' 7.1 ', 7.1],
    ['-2', -2],
    ['+4.0', 4],
    ['38.30', 38.3],
  ])('parses %j', (input, expected) => {
    expect(parseTemperature(input)).toEqual({ value: expected });
  });

  it.each([
    ['ERR', 'non-numeric value: ERR'],
    ['', 'empty value'],
    ['   ', 'empty value'],
    ['3,8', 'non-numeric value: 3,8'],
    ['4.1C', 'non-numeric value: 4.1C'],
  ])('marks %j as invalid', (input, reason) => {
    expect(parseTemperature(input)).toEqual({ invalidReason: reason });
  });
});

describe('fahrenheitToCelsius', () => {
  it('converts the Haifa sample values', () => {
    expect(fahrenheitToCelsius(38.3)).toBe(3.5);
    expect(fahrenheitToCelsius(39.0)).toBe(3.89);
  });

  it('converts exactly at the 5 °C threshold', () => {
    expect(fahrenheitToCelsius(41)).toBe(5);
  });
});

describe('normalizeReadings', () => {
  it('keeps Celsius values unchanged when the unit is C', () => {
    const { readings } = normalizeReadings([raw('2026-09-14 06:00', '3.8')], 'C');
    expect(readings[0].temperatureC).toBe(3.8);
  });

  it('converts only when the caller selects F', () => {
    const rows = [raw('14/09/2026 06:00', '38.3')];
    expect(normalizeReadings(rows, 'F').readings[0].temperatureC).toBe(3.5);
    expect(normalizeReadings(rows, 'C').readings[0].temperatureC).toBe(38.3);
  });

  it('normalizes the Haifa sample: DD/MM dates, Fahrenheit and ERR', () => {
    const result = normalizeReadings(
      [
        { line: 2, rawTimestamp: '14/09/2026 06:00', rawTemperature: '38.3' },
        { line: 3, rawTimestamp: '14/09/2026 06:15', rawTemperature: '39.0' },
        { line: 4, rawTimestamp: '14/09/2026 06:30', rawTemperature: 'ERR' },
      ],
      'F',
    );
    expect(result.readings).toEqual([
      { line: 2, rawTimestamp: '14/09/2026 06:00', rawTemperature: '38.3', recordedAt: '2026-09-14 06:00:00', temperatureC: 3.5, invalidReason: null },
      { line: 3, rawTimestamp: '14/09/2026 06:15', rawTemperature: '39.0', recordedAt: '2026-09-14 06:15:00', temperatureC: 3.89, invalidReason: null },
      { line: 4, rawTimestamp: '14/09/2026 06:30', rawTemperature: 'ERR', recordedAt: '2026-09-14 06:30:00', temperatureC: null, invalidReason: 'non-numeric value: ERR' },
    ]);
    expect(result.rejected).toEqual([]);
  });

  it('keeps an invalid temperature as a traceable reading, never as 0 or dropped', () => {
    const { readings } = normalizeReadings([raw('2026-09-14 06:30', 'ERR')], 'C');
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ rawTemperature: 'ERR', temperatureC: null, invalidReason: 'non-numeric value: ERR' });
  });

  it('preserves the raw timestamp and temperature text exactly', () => {
    const { readings } = normalizeReadings([raw(' 2026-09-14T06:00 ', ' 38.30 ')], 'F');
    expect(readings[0]).toMatchObject({
      rawTimestamp: ' 2026-09-14T06:00 ',
      rawTemperature: ' 38.30 ',
      recordedAt: '2026-09-14 06:00:00',
      temperatureC: 3.5,
    });
  });

  it('rejects rows with an unparseable timestamp and reports them', () => {
    const result = normalizeReadings(
      [{ line: 7, rawTimestamp: '31/02/2026 06:00', rawTemperature: '4.0' }],
      'C',
    );
    expect(result.readings).toEqual([]);
    expect(result.rejected).toEqual([
      { line: 7, rawTimestamp: '31/02/2026 06:00', rawTemperature: '4.0', reason: 'unrecognised timestamp' },
    ]);
  });

  it('sorts out-of-order rows chronologically (TL-0417 05:45 listed after 06:30)', () => {
    const { readings } = normalizeReadings(
      [
        raw('2026-09-14 06:00', '4.1'),
        raw('2026-09-14 06:15', '9.4'),
        raw('2026-09-14 06:30', '4.3'),
        raw('2026-09-14 05:45', '4.0'),
      ],
      'C',
    );
    expect(readings.map((r) => r.recordedAt)).toEqual([
      '2026-09-14 05:45:00',
      '2026-09-14 06:00:00',
      '2026-09-14 06:15:00',
      '2026-09-14 06:30:00',
    ]);
  });

  it('sorts mixed timestamp formats by actual time', () => {
    const { readings } = normalizeReadings(
      [raw('14/09/2026 07:00', '4'), raw('2026-09-14 06:00', '4')],
      'C',
    );
    expect(readings.map((r) => r.recordedAt)).toEqual(['2026-09-14 06:00:00', '2026-09-14 07:00:00']);
  });

  it('keeps one copy of an exact duplicate and reports the other (Jerusalem 06:15 3.9)', () => {
    const result = normalizeReadings(
      [
        { line: 2, rawTimestamp: '2026-09-14 06:00', rawTemperature: '3.8' },
        { line: 3, rawTimestamp: '2026-09-14 06:15', rawTemperature: '3.9' },
        { line: 4, rawTimestamp: '2026-09-14 06:15', rawTemperature: '3.9' },
      ],
      'C',
    );
    expect(result.readings.map((r) => r.line)).toEqual([2, 3]);
    expect(result.duplicates).toEqual([
      { line: 4, rawTimestamp: '2026-09-14 06:15', rawTemperature: '3.9', keptLine: 3 },
    ]);
    expect(result.conflicts).toEqual([]);
  });

  it('treats the same value written differently as a duplicate', () => {
    const result = normalizeReadings(
      [raw('2026-09-14 06:15', '3.9'), raw('2026-09-14T06:15:00', '3.90')],
      'C',
    );
    expect(result.readings).toHaveLength(1);
    expect(result.duplicates).toHaveLength(1);
  });

  it('treats two invalid values at the same timestamp as a duplicate', () => {
    const result = normalizeReadings([raw('2026-09-14 06:30', 'ERR'), raw('2026-09-14 06:30', 'ERR')], 'C');
    expect(result.duplicates).toHaveLength(1);
    expect(result.conflicts).toHaveLength(0);
  });

  it('reports a conflict when the same timestamp has a different value, keeping the first row', () => {
    const result = normalizeReadings(
      [
        { line: 2, rawTimestamp: '2026-09-14 06:15', rawTemperature: '3.9' },
        { line: 3, rawTimestamp: '2026-09-14 06:15', rawTemperature: '9.4' },
        { line: 4, rawTimestamp: '2026-09-14 06:15', rawTemperature: 'ERR' },
      ],
      'C',
    );
    expect(result.readings).toHaveLength(1);
    expect(result.readings[0]).toMatchObject({ line: 2, temperatureC: 3.9 });
    expect(result.conflicts).toEqual([
      { line: 3, rawTimestamp: '2026-09-14 06:15', rawTemperature: '9.4', keptLine: 2 },
      { line: 4, rawTimestamp: '2026-09-14 06:15', rawTemperature: 'ERR', keptLine: 2 },
    ]);
    expect(result.duplicates).toEqual([]);
  });

  it('accounts for every input row exactly once', () => {
    const rows = [
      raw('2026-09-14 06:00', '3.8'),
      raw('2026-09-14 06:00', '3.8'),
      raw('2026-09-14 06:00', '4.2'),
      raw('not a date', '3.8'),
      raw('2026-09-14 06:15', 'ERR'),
    ];
    const r = normalizeReadings(rows, 'C');
    expect(r.readings.length + r.rejected.length + r.duplicates.length + r.conflicts.length).toBe(rows.length);
  });

  it('returns empty results for no rows', () => {
    expect(normalizeReadings([], 'C')).toEqual({ readings: [], rejected: [], duplicates: [], conflicts: [] });
  });
});
