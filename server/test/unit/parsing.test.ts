import { describe, expect, it } from 'vitest';
import {
  ColumnMappingError,
  detectColumns,
  extractColumns,
  parseCsv,
} from '../../src/parsing/index.js';

describe('parseCsv', () => {
  it('returns headers and rows as raw strings with source line numbers', () => {
    const parsed = parseCsv('Time,Temp\n2026-09-14 06:00,3.8\n2026-09-14 06:15,3.9');
    expect(parsed.headers).toEqual(['Time', 'Temp']);
    expect(parsed.rows).toEqual([
      { line: 2, cells: ['2026-09-14 06:00', '3.8'] },
      { line: 3, cells: ['2026-09-14 06:15', '3.9'] },
    ]);
    expect(parsed.issues).toEqual([]);
  });

  it('keeps values exactly as written — no number, date or unit interpretation', () => {
    const parsed = parseCsv(
      'Time,Temp\n14/09/2026 06:30,ERR\n14/09/2026 06:00,38.30\n 2026-09-14 06:45 , 7.1 ',
    );
    expect(parsed.rows.map((r) => r.cells)).toEqual([
      ['14/09/2026 06:30', 'ERR'],
      ['14/09/2026 06:00', '38.30'],
      [' 2026-09-14 06:45 ', ' 7.1 '],
    ]);
    for (const row of parsed.rows) {
      for (const cell of row.cells) expect(typeof cell).toBe('string');
    }
  });

  it('strips a UTF-8 BOM from the first header', () => {
    const parsed = parseCsv('﻿Time,Temp\n2026-09-14 06:00,3.8');
    expect(parsed.headers).toEqual(['Time', 'Temp']);
    expect(detectColumns(parsed.headers).confident).toBe(true);
  });

  it('handles CRLF line endings without leaving \\r in values', () => {
    const parsed = parseCsv('Time,Temp\r\n2026-09-14 06:00,3.8\r\n2026-09-14 06:15,3.9\r\n');
    expect(parsed.headers).toEqual(['Time', 'Temp']);
    expect(parsed.rows.map((r) => r.cells)).toEqual([
      ['2026-09-14 06:00', '3.8'],
      ['2026-09-14 06:15', '3.9'],
    ]);
  });

  it('handles quoted fields containing commas', () => {
    const parsed = parseCsv('Time,Temp,Note\n2026-09-14 06:00,3.8,"door opened, delivery"');
    expect(parsed.rows[0].cells).toEqual(['2026-09-14 06:00', '3.8', 'door opened, delivery']);
  });

  it('returns no headers and no rows for an empty file', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [], issues: [] });
    expect(parseCsv('\n\n  \n')).toEqual({ headers: [], rows: [], issues: [] });
  });

  it('returns headers and no rows for a header-only file', () => {
    expect(parseCsv('Time,Temp\n')).toEqual({ headers: ['Time', 'Temp'], rows: [], issues: [] });
  });

  it('skips blank lines but keeps original line numbers', () => {
    const parsed = parseCsv('Time,Temp\n2026-09-14 06:00,3.8\n\n   \n2026-09-14 06:15,3.9\n');
    expect(parsed.rows.map((r) => r.line)).toEqual([2, 5]);
  });

  it('keeps rows that have an empty temperature cell (they are not blank lines)', () => {
    const parsed = parseCsv('Time,Temp\n2026-09-14 06:00,\n');
    expect(parsed.rows).toEqual([{ line: 2, cells: ['2026-09-14 06:00', ''] }]);
  });

  it('detects a semicolon delimiter', () => {
    const parsed = parseCsv('Time;Temp\n2026-09-14 06:00;3.8');
    expect(parsed.headers).toEqual(['Time', 'Temp']);
    expect(parsed.rows[0].cells).toEqual(['2026-09-14 06:00', '3.8']);
  });

  it('reports malformed CSV such as an unclosed quote', () => {
    const parsed = parseCsv('Time,Temp\n"2026-09-14 06:00,3.8\n2026-09-14 06:15,3.9');
    expect(parsed.issues.length).toBeGreaterThan(0);
    expect(parsed.issues[0].line).toBe(2);
  });
});

describe('detectColumns', () => {
  it('detects normal Time/Temp headers', () => {
    expect(detectColumns(['Time', 'Temp'])).toEqual({
      timestamp: 0,
      temperature: 1,
      confident: true,
      matches: { timestamp: [0], temperature: [1] },
    });
  });

  it('detects reversed column order', () => {
    const d = detectColumns(['Temperature', 'Timestamp']);
    expect(d).toMatchObject({ timestamp: 1, temperature: 0, confident: true });
  });

  it('ignores case and surrounding whitespace', () => {
    const d = detectColumns(['  TIME ', 'temp  ']);
    expect(d).toMatchObject({ timestamp: 0, temperature: 1, confident: true });
  });

  it.each([[['Date/Time', 'Temp']], [['DateTime', 'Temperature']], [['date time', 'TEMP']]])(
    'accepts alias variants %j',
    (headers) => {
      expect(detectColumns(headers).confident).toBe(true);
    },
  );

  it('does not treat a generic "Value" header as the temperature column', () => {
    const d = detectColumns(['Time', 'Value']);
    expect(d).toMatchObject({ timestamp: 0, temperature: null, confident: false });
  });

  it('ignores a bracketed unit suffix for matching only', () => {
    const d = detectColumns(['Time', 'Temperature (°F)']);
    expect(d).toMatchObject({ timestamp: 0, temperature: 1, confident: true });
    expect(detectColumns(['Time', 'Temp[C]']).temperature).toBe(1);
  });

  it('finds the columns among extra columns, wherever they are', () => {
    const d = detectColumns(['Serial', 'Battery', 'Temp', 'Note', 'Time']);
    expect(d).toMatchObject({ timestamp: 4, temperature: 2, confident: true });
  });

  it('leaves both unresolved when no header is recognised', () => {
    expect(detectColumns(['A', 'B'])).toEqual({
      timestamp: null,
      temperature: null,
      confident: false,
      matches: { timestamp: [], temperature: [] },
    });
  });

  it('does not infer from cell contents when the "header" is actually data', () => {
    const parsed = parseCsv('2026-09-14 06:00,3.8\n2026-09-14 06:15,3.9');
    expect(detectColumns(parsed.headers)).toMatchObject({
      timestamp: null,
      temperature: null,
      confident: false,
    });
  });

  it('resolves the recognised column and leaves the other unresolved', () => {
    const d = detectColumns(['Time', 'Reading']);
    expect(d).toMatchObject({ timestamp: 0, temperature: null, confident: false });
  });

  it('leaves a role unresolved when several headers match it', () => {
    const d = detectColumns(['Date', 'Time', 'Temp']);
    expect(d).toMatchObject({ timestamp: null, temperature: 2, confident: false });
    expect(d.matches.timestamp).toEqual([0, 1]);
  });

  it('returns unresolved for an empty header list', () => {
    expect(detectColumns([]).confident).toBe(false);
  });
});

describe('extractColumns', () => {
  const parsed = parseCsv('Serial,Temp,Time\nX1,3.8,2026-09-14 06:00\nX1,ERR,2026-09-14 06:15');

  it('applies the detected mapping, returning raw strings', () => {
    const d = detectColumns(parsed.headers);
    const rows = extractColumns(parsed, { timestamp: d.timestamp!, temperature: d.temperature! });
    expect(rows).toEqual([
      { line: 2, rawTimestamp: '2026-09-14 06:00', rawTemperature: '3.8' },
      { line: 3, rawTimestamp: '2026-09-14 06:15', rawTemperature: 'ERR' },
    ]);
  });

  it('applies a manual mapping chosen by the user when headers are not recognised', () => {
    const unknown = parseCsv('A,B\n3.8,2026-09-14 06:00');
    expect(detectColumns(unknown.headers).confident).toBe(false);
    expect(extractColumns(unknown, { timestamp: 1, temperature: 0 })).toEqual([
      { line: 2, rawTimestamp: '2026-09-14 06:00', rawTemperature: '3.8' },
    ]);
  });

  it('lets a manual mapping override a detected one', () => {
    expect(extractColumns(parsed, { timestamp: 2, temperature: 0 })[0]).toEqual({
      line: 2,
      rawTimestamp: '2026-09-14 06:00',
      rawTemperature: 'X1',
    });
  });

  it('returns an empty string for a cell missing from a short row', () => {
    const short = parseCsv('Time,Temp\n2026-09-14 06:00');
    expect(extractColumns(short, { timestamp: 0, temperature: 1 })).toEqual([
      { line: 2, rawTimestamp: '2026-09-14 06:00', rawTemperature: '' },
    ]);
  });

  it('returns no rows for a header-only file', () => {
    expect(extractColumns(parseCsv('Time,Temp'), { timestamp: 0, temperature: 1 })).toEqual([]);
  });

  it.each([
    [{ timestamp: 3, temperature: 1 }],
    [{ timestamp: -1, temperature: 1 }],
    [{ timestamp: 0.5, temperature: 1 }],
    [{ timestamp: 1, temperature: 1 }],
  ])('rejects an invalid mapping %j', (mapping) => {
    expect(() => extractColumns(parsed, mapping)).toThrow(ColumnMappingError);
  });
});
