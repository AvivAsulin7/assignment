import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../src/api/app.js';
import { openDatabase, type Db } from '../../src/persistence/db.js';

let db: Db;
let app: Express;

beforeEach(() => {
  db = openDatabase(':memory:');
  app = createApp(db);
});

const CSV = 'Time,Temp\n2026-09-14 06:00,3.8\n2026-09-14 06:15,3.9\n';

const importBody = (overrides: Record<string, unknown> = {}) => ({
  filename: 'jerusalem.csv',
  content: CSV,
  columns: { timestamp: 0, temperature: 1 },
  loggerId: 'TL-0512',
  branch: 'Jerusalem',
  fridge: 'Dairy',
  unit: 'C',
  ...overrides,
});

const count = (table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('POST /api/uploads/preview', () => {
  it('returns detection, counts and sample rows', async () => {
    const res = await request(app)
      .post('/api/uploads/preview')
      .send({ filename: 'haifa.csv', content: 'Date/Time,Temp\n14/09/2026 06:00,38.3\n14/09/2026 06:30,ERR\n' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      headers: ['Date/Time', 'Temp'],
      detection: { confident: true, timestamp: 0, temperature: 1 },
      columns: { timestamp: 0, temperature: 1 },
      rowCount: 2,
      counts: { valid: 1, invalid: 1, rejected: 0, duplicates: 0, conflicts: 0 },
      firstAt: '2026-09-14 06:00:00',
      lastAt: '2026-09-14 06:30:00',
    });
    expect(res.body.sampleRows[1]).toMatchObject({ rawTemperature: 'ERR', invalidReason: 'non-numeric value: ERR' });
  });

  it('uses explicitly chosen columns when headers are not recognised', async () => {
    const content = 'A,B\n3.8,2026-09-14 06:00\n';
    const unresolved = await request(app).post('/api/uploads/preview').send({ filename: 'x.csv', content });
    expect(unresolved.body).toMatchObject({ detection: { confident: false }, columns: null, counts: null });

    const chosen = await request(app)
      .post('/api/uploads/preview')
      .send({ filename: 'x.csv', content, columns: { timestamp: 1, temperature: 0 } });
    expect(chosen.status).toBe(200);
    expect(chosen.body.counts).toMatchObject({ valid: 1 });
  });

  it('writes nothing to the database', async () => {
    await request(app).post('/api/uploads/preview').send({ filename: 'a.csv', content: CSV });
    expect(count('fridges') + count('imports') + count('readings')).toBe(0);
  });

  it.each([
    ['filename missing', { content: CSV }],
    ['content missing', { filename: 'a.csv' }],
    ['content not a string', { filename: 'a.csv', content: 42 }],
    ['columns not an object', { filename: 'a.csv', content: CSV, columns: 1 }],
    ['negative column index', { filename: 'a.csv', content: CSV, columns: { timestamp: -1, temperature: 1 } }],
    ['incomplete columns', { filename: 'a.csv', content: CSV, columns: { timestamp: 0 } }],
  ])('rejects a malformed request (%s) with 400 "Invalid request"', async (_name, body) => {
    const res = await request(app).post('/api/uploads/preview').send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid request' });
  });

  it('rejects an invalid column mapping with 400', async () => {
    const res = await request(app)
      .post('/api/uploads/preview')
      .send({ filename: 'a.csv', content: CSV, columns: { timestamp: 0, temperature: 7 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/temperature column/);
  });
});

describe('POST /api/imports', () => {
  it('imports and returns the summary with 201', async () => {
    const res = await request(app).post('/api/imports').send(importBody());
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      importId: 1,
      fridgeId: 1,
      counts: { rows: 2, inserted: 2, invalid: 0, rejected: 0, duplicates: 0, conflicts: 0 },
      rejected: [],
      conflicts: [],
    });
  });

  it('persists the readings', async () => {
    await request(app).post('/api/imports').send(importBody());
    expect(db.prepare('SELECT logger_id, recorded_at, temperature_c FROM readings ORDER BY recorded_at').all()).toEqual([
      { logger_id: 'TL-0512', recorded_at: '2026-09-14 06:00:00', temperature_c: 3.8 },
      { logger_id: 'TL-0512', recorded_at: '2026-09-14 06:15:00', temperature_c: 3.9 },
    ]);
  });

  it('imports Fahrenheit as Celsius and keeps ERR as an invalid reading (Haifa)', async () => {
    const res = await request(app)
      .post('/api/imports')
      .send(
        importBody({
          loggerId: 'TL-0231', branch: 'Haifa', unit: 'F',
          content: 'Date/Time,Temp\n14/09/2026 06:00,38.3\n14/09/2026 06:30,ERR\n',
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.counts).toMatchObject({ inserted: 2, invalid: 1 });
    expect(db.prepare('SELECT raw_temperature, temperature_c, is_valid FROM readings ORDER BY recorded_at').all()).toEqual([
      { raw_temperature: '38.3', temperature_c: 3.5, is_valid: 1 },
      { raw_temperature: 'ERR', temperature_c: null, is_valid: 0 },
    ]);
  });

  it('treats a re-upload as duplicates', async () => {
    await request(app).post('/api/imports').send(importBody());
    const res = await request(app).post('/api/imports').send(importBody());
    expect(res.status).toBe(201);
    expect(res.body.counts).toMatchObject({ inserted: 0, duplicates: 2 });
    expect(count('readings')).toBe(2);
  });

  it.each([
    ['filename missing', { filename: undefined }],
    ['content missing', { content: undefined }],
    ['loggerId missing', { loggerId: undefined }],
    ['branch not a string', { branch: 42 }],
    ['fridge missing', { fridge: undefined }],
    ['unit not C/F', { unit: 'K' }],
    ['unit lower-case', { unit: 'c' }],
    ['unit missing', { unit: undefined }],
    ['columns missing', { columns: undefined }],
    ['columns not an object', { columns: 'Time,Temp' }],
    ['negative column index', { columns: { timestamp: -1, temperature: 1 } }],
    ['non-integer column index', { columns: { timestamp: 0, temperature: 1.5 } }],
    ['column index as string', { columns: { timestamp: '0', temperature: 1 } }],
  ])('rejects %s with 400 "Invalid request"', async (_name, overrides) => {
    const res = await request(app).post('/api/imports').send(importBody(overrides));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid request' });
    expect(count('imports')).toBe(0);
  });

  it('maps an import error (blank metadata) to 400 with its message', async () => {
    const res = await request(app).post('/api/imports').send(importBody({ fridge: '   ' }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Logger ID, branch and fridge are required.' });
  });

  it('maps an import error (no data rows) to 400', async () => {
    const res = await request(app).post('/api/imports').send(importBody({ content: 'Time,Temp\n' }));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'The file has no data rows.' });
  });

  it('rejects a column mapping outside the file or using one column twice with 400', async () => {
    const outside = await request(app).post('/api/imports').send(importBody({ columns: { timestamp: 0, temperature: 5 } }));
    expect(outside.status).toBe(400);
    const same = await request(app).post('/api/imports').send(importBody({ columns: { timestamp: 1, temperature: 1 } }));
    expect(same.status).toBe(400);
    expect(same.body.error).toMatch(/must be different/);
    expect(count('imports')).toBe(0);
  });

  it('returns 500 without internal details for an unexpected failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.exec(`CREATE TRIGGER boom BEFORE INSERT ON readings BEGIN SELECT RAISE(ABORT, 'secret internals'); END;`);
    const res = await request(app).post('/api/imports').send(importBody());
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|stack/);
    expect(count('imports')).toBe(0);
    log.mockRestore();
  });
});

describe('request body handling', () => {
  it('rejects malformed JSON with 400', async () => {
    const res = await request(app)
      .post('/api/imports')
      .set('Content-Type', 'application/json')
      .send('{"filename": "a.csv", ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Malformed JSON body' });
  });

  it('rejects a non-JSON body with 400', async () => {
    const res = await request(app).post('/api/uploads/preview').set('Content-Type', 'text/plain').send(CSV);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid request' });
  });

  it('rejects a body over the size limit with 413', async () => {
    const res = await request(app)
      .post('/api/uploads/preview')
      .send({ filename: 'big.csv', content: 'x'.repeat(6 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });

  it('still returns JSON 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});
