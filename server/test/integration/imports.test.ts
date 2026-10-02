import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ImportError, importUpload, previewUpload, type ImportInput } from '../../src/imports/service.js';
import { openDatabase, type Db } from '../../src/persistence/db.js';

const NOW = '2026-09-20T10:00:00.000Z';
let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
});

const upload = (overrides: Partial<ImportInput> = {}): ImportInput => ({
  filename: 'logger.csv',
  content: 'Time,Temp\n2026-09-14 06:00,3.8\n2026-09-14 06:15,3.9\n',
  columns: { timestamp: 0, temperature: 1 },
  loggerId: 'TL-0512',
  branch: 'Jerusalem',
  fridge: 'Dairy',
  unit: 'C',
  ...overrides,
});

const count = (table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

const readings = () =>
  db
    .prepare(
      `SELECT r.*, f.branch_name, f.name AS fridge_name FROM readings r
       JOIN fridges f ON f.id = r.fridge_id ORDER BY r.logger_id, r.recorded_at`,
    )
    .all() as Record<string, unknown>[];

describe('schema and constraints', () => {
  it('creates the three tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((t) => (t as { name: string }).name);
    expect(tables).toEqual(['fridges', 'imports', 'readings']);
  });

  it('can be applied twice (opening an existing database)', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fridges-')), 'test.db');
    openDatabase(file).close();
    expect(() => openDatabase(file).close()).not.toThrow();
  });

  it('enforces one reading per logger + timestamp', () => {
    importUpload(db, upload(), NOW);
    expect(() =>
      db
        .prepare(
          `INSERT INTO readings (import_id, fridge_id, logger_id, source_line, recorded_at,
             raw_timestamp, raw_temperature, temperature_c, is_valid, invalid_reason)
           VALUES (1, 1, 'TL-0512', 9, '2026-09-14 06:00:00', 'x', '5.0', 5.0, 1, NULL)`,
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it('enforces unique normalized fridge names', () => {
    db.prepare(
      "INSERT INTO fridges (branch_name, name, branch_key, name_key, created_at) VALUES ('A', 'B', 'a', 'b', 'now')",
    ).run();
    expect(() =>
      db
        .prepare(
          "INSERT INTO fridges (branch_name, name, branch_key, name_key, created_at) VALUES ('a', 'b', 'a', 'b', 'now')",
        )
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it('rejects an unknown unit and a reading whose validity and value disagree', () => {
    importUpload(db, upload(), NOW);
    expect(() => db.prepare("UPDATE imports SET unit = 'K'").run()).toThrow(/CHECK/);
    expect(() => db.prepare('UPDATE readings SET temperature_c = NULL WHERE id = 1').run()).toThrow(/CHECK/);
  });

  it('enforces foreign keys', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO imports (fridge_id, logger_id, unit, filename, timestamp_column, temperature_column,
             raw_content, row_count, inserted_count, invalid_count, rejected_count, duplicate_count,
             conflict_count, imported_at)
           VALUES (999, 'L', 'C', 'f', 't', 'v', '', 0, 0, 0, 0, 0, 0, 'now')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('previewUpload', () => {
  it('reports detection, counts and sample rows without writing anything', () => {
    const preview = previewUpload(
      'Temp,Time\n4.1,2026-09-14 06:00\nERR,2026-09-14 06:15\n4.1,2026-09-14 06:00\nx,bad date\n',
    );
    expect(preview.detection.confident).toBe(true);
    expect(preview.columns).toEqual({ timestamp: 1, temperature: 0 });
    expect(preview.rowCount).toBe(4);
    expect(preview.counts).toEqual({ valid: 1, invalid: 1, rejected: 1, duplicates: 1, conflicts: 0 });
    expect(preview.firstAt).toBe('2026-09-14 06:00:00');
    expect(preview.lastAt).toBe('2026-09-14 06:15:00');
    expect(preview.sampleRows[1]).toEqual({
      line: 3, rawTimestamp: '2026-09-14 06:15', rawTemperature: 'ERR',
      recordedAt: '2026-09-14 06:15:00', invalidReason: 'non-numeric value: ERR',
    });
    expect(count('fridges') + count('imports') + count('readings')).toBe(0);
  });

  it('leaves counts empty until unrecognised columns are chosen, then uses the choice', () => {
    const content = 'A,B\n2026-09-14 06:00,3.8\n';
    expect(previewUpload(content)).toMatchObject({ columns: null, counts: null, rowCount: 1 });
    expect(previewUpload(content, { timestamp: 0, temperature: 1 }).counts).toMatchObject({ valid: 1 });
  });
});

describe('importUpload', () => {
  it('stores the import, the fridge and its readings with correct counts', () => {
    const summary = importUpload(db, upload(), NOW);
    expect(summary.counts).toEqual({ rows: 2, inserted: 2, invalid: 0, rejected: 0, duplicates: 0, conflicts: 0 });

    const imp = db.prepare('SELECT * FROM imports WHERE id = ?').get(summary.importId) as Record<string, unknown>;
    expect(imp).toMatchObject({
      fridge_id: summary.fridgeId, logger_id: 'TL-0512', unit: 'C', filename: 'logger.csv',
      timestamp_column: 'Time', temperature_column: 'Temp', raw_content: upload().content,
      row_count: 2, inserted_count: 2, imported_at: NOW,
    });
    expect(readings()).toMatchObject([
      { import_id: summary.importId, logger_id: 'TL-0512', source_line: 2, recorded_at: '2026-09-14 06:00:00', temperature_c: 3.8, is_valid: 1 },
      { import_id: summary.importId, logger_id: 'TL-0512', source_line: 3, recorded_at: '2026-09-14 06:15:00', temperature_c: 3.9, is_valid: 1 },
    ]);
  });

  it('finds an existing fridge by normalized branch and fridge name ("tel aviv" = "Tel Aviv")', () => {
    const a = importUpload(db, upload({ loggerId: 'TL-0417', branch: 'Tel Aviv', fridge: 'Walk-in' }), NOW);
    const b = importUpload(
      db,
      upload({ loggerId: 'TL-0999', branch: ' tel  aviv ', fridge: 'WALK-IN', content: 'Time,Temp\n2026-09-15 06:00,4\n' }),
      NOW,
    );
    expect(b.fridgeId).toBe(a.fridgeId);
    expect(count('fridges')).toBe(1);
    expect(db.prepare('SELECT branch_name, name FROM fridges').get()).toEqual({ branch_name: 'Tel Aviv', name: 'Walk-in' });
  });

  it('makes re-uploading the same file safe: nothing inserted, all duplicates', () => {
    importUpload(db, upload(), NOW);
    const again = importUpload(db, upload(), NOW);
    expect(again.counts).toMatchObject({ rows: 2, inserted: 0, duplicates: 2, conflicts: 0 });
    expect(count('readings')).toBe(2);
    expect(count('imports')).toBe(2); // every confirmed upload is recorded
  });

  it('counts in-file and stored duplicates together (Jerusalem 06:15 3.9 twice)', () => {
    importUpload(db, upload({ content: 'Time,Temp\n2026-09-14 06:00,3.8\n' }), NOW);
    const summary = importUpload(
      db,
      upload({ content: 'Time,Temp\n2026-09-14 06:00,3.80\n2026-09-14 06:15,3.9\n2026-09-14 06:15,3.9\n' }),
      NOW,
    );
    expect(summary.counts).toMatchObject({ rows: 3, inserted: 1, duplicates: 2, conflicts: 0 });
  });

  it('reports a conflict for the same logger + timestamp with a different value, keeping the stored value', () => {
    importUpload(db, upload(), NOW);
    const summary = importUpload(
      db,
      upload({ content: 'Time,Temp\n2026-09-14 06:00,9.9\n2026-09-14 06:15,ERR\n2026-09-14 06:30,4.0\n' }),
      NOW,
    );
    expect(summary.counts).toMatchObject({ inserted: 1, duplicates: 0, conflicts: 2 });
    expect(summary.conflicts).toEqual([
      { line: 2, rawTimestamp: '2026-09-14 06:00', rawTemperature: '9.9', reason: 'already stored with a different value (import 1, line 2)' },
      { line: 3, rawTimestamp: '2026-09-14 06:15', rawTemperature: 'ERR', reason: 'already stored with a different value (import 1, line 3)' },
    ]);
    expect(readings().map((r) => r.temperature_c)).toEqual([3.8, 3.9, 4.0]);
    expect(db.prepare('SELECT conflict_count FROM imports WHERE id = 2').get()).toEqual({ conflict_count: 2 });
  });

  it('reports in-file conflicts too', () => {
    const summary = importUpload(
      db,
      upload({ content: 'Time,Temp\n2026-09-14 06:00,3.8\n2026-09-14 06:00,4.8\n' }),
      NOW,
    );
    expect(summary.counts).toMatchObject({ inserted: 1, conflicts: 1 });
    expect(summary.conflicts[0].reason).toMatch(/line 2 .* in this file/);
  });

  it('does not rewrite history when a logger later goes into another fridge (TL-0417)', () => {
    const walkIn = importUpload(
      db,
      upload({ loggerId: 'TL-0417', branch: 'Tel Aviv', fridge: 'Walk-in', content: 'Time,Temp\n2026-09-14 06:00,4.1\n2026-09-14 06:15,9.4\n' }),
      NOW,
    );
    const display = importUpload(
      db,
      upload({ loggerId: 'TL-0417', branch: 'tel aviv', fridge: 'Display 2', content: 'Time,Temp\n2026-09-17 06:00,3.7\n' }),
      NOW,
    );
    expect(display.fridgeId).not.toBe(walkIn.fridgeId);
    // New fridge in a known branch keeps the branch's first-seen spelling (A8).
    expect(readings().map((r) => r.branch_name)).toEqual(['Tel Aviv', 'Tel Aviv', 'Tel Aviv']);
    expect(readings().map((r) => [r.recorded_at, r.fridge_name])).toEqual([
      ['2026-09-14 06:00:00', 'Walk-in'],
      ['2026-09-14 06:15:00', 'Walk-in'],
      ['2026-09-17 06:00:00', 'Display 2'],
    ]);
  });

  it('detects a re-upload under the wrong fridge as already imported', () => {
    importUpload(db, upload(), NOW);
    const wrong = importUpload(db, upload({ fridge: 'Cream cakes' }), NOW);
    expect(wrong.counts).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(readings().every((r) => r.fridge_name === 'Dairy')).toBe(true);
  });

  it('stores Fahrenheit as Celsius, keeps raw text, and keeps ERR as a traceable invalid reading (Haifa)', () => {
    const content = 'Date/Time,Temp\n14/09/2026 06:00,38.3\n14/09/2026 06:15,39.0\n14/09/2026 06:30,ERR\n';
    const summary = importUpload(
      db,
      upload({ loggerId: 'TL-0231', branch: 'Haifa', fridge: 'Dairy', unit: 'F', content }),
      NOW,
    );
    expect(summary.counts).toMatchObject({ rows: 3, inserted: 3, invalid: 1 });
    expect(readings()).toMatchObject([
      { raw_timestamp: '14/09/2026 06:00', raw_temperature: '38.3', recorded_at: '2026-09-14 06:00:00', temperature_c: 3.5, is_valid: 1, invalid_reason: null },
      { raw_timestamp: '14/09/2026 06:15', raw_temperature: '39.0', recorded_at: '2026-09-14 06:15:00', temperature_c: 3.89, is_valid: 1 },
      { raw_timestamp: '14/09/2026 06:30', raw_temperature: 'ERR', recorded_at: '2026-09-14 06:30:00', temperature_c: null, is_valid: 0, invalid_reason: 'non-numeric value: ERR' },
    ]);
    expect(db.prepare('SELECT unit, invalid_count FROM imports').get()).toEqual({ unit: 'F', invalid_count: 1 });
  });

  it('does not insert rows with an unparseable timestamp, but counts, lists and keeps them in raw_content', () => {
    const content = 'Time,Temp\n2026-09-14 06:00,3.8\n31/02/2026 06:15,3.9\n';
    const summary = importUpload(db, upload({ content }), NOW);
    expect(summary.counts).toMatchObject({ rows: 2, inserted: 1, rejected: 1 });
    expect(summary.rejected).toEqual([
      { line: 3, rawTimestamp: '31/02/2026 06:15', rawTemperature: '3.9', reason: 'unrecognised timestamp' },
    ]);
    expect(count('readings')).toBe(1);
    expect(db.prepare('SELECT rejected_count, raw_content FROM imports').get()).toEqual({ rejected_count: 1, raw_content: content });
  });

  it('keeps row accounting consistent: rows = inserted + rejected + duplicates + conflicts', () => {
    importUpload(db, upload(), NOW);
    const s = importUpload(
      db,
      upload({ content: 'Time,Temp\n2026-09-14 06:00,3.8\n2026-09-14 06:15,5\nbad,1\n2026-09-14 07:00,ERR\n2026-09-14 07:00,ERR\n' }),
      NOW,
    ).counts;
    expect(s.rows).toBe(s.inserted + s.rejected + s.duplicates + s.conflicts);
  });

  it('stores nothing when the import fails part-way (transaction rollback)', () => {
    // Test-only trigger that makes the second reading insert fail.
    db.exec(`CREATE TRIGGER fail_on_boom BEFORE INSERT ON readings
             WHEN NEW.raw_temperature = 'BOOM' BEGIN SELECT RAISE(ABORT, 'forced failure'); END;`);
    expect(() =>
      importUpload(db, upload({ content: 'Time,Temp\n2026-09-14 06:00,3.8\n2026-09-14 06:15,BOOM\n' }), NOW),
    ).toThrow(/forced failure/);
    expect(count('fridges') + count('imports') + count('readings')).toBe(0);
  });

  it.each([
    [{ loggerId: '  ' }],
    [{ branch: '' }],
    [{ fridge: ' ' }],
    [{ content: '' }],
    [{ content: 'Time,Temp\n' }],
  ])('rejects invalid input %j and stores nothing', (overrides) => {
    expect(() => importUpload(db, upload(overrides), NOW)).toThrow(ImportError);
    expect(count('imports')).toBe(0);
  });

  it('trims logger ID, branch and fridge before storing', () => {
    importUpload(db, upload({ loggerId: ' TL-0512 ', branch: ' Jerusalem ', fridge: ' Dairy ' }), NOW);
    expect(db.prepare('SELECT logger_id FROM imports').get()).toEqual({ logger_id: 'TL-0512' });
    expect(db.prepare('SELECT branch_name, name FROM fridges').get()).toEqual({ branch_name: 'Jerusalem', name: 'Dairy' });
  });
});
