import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../src/api/app.js';
import { importUpload, type ImportInput } from '../../src/imports/service.js';
import { openDatabase, type Db } from '../../src/persistence/db.js';

const sampleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../sample-data');

// Same metadata as scripts/seed.ts — what a user would type at upload.
const SAMPLES = [
  { file: 'jerusalem-dairy-TL-0512.csv', loggerId: 'TL-0512', branch: 'Jerusalem', fridge: 'Dairy', unit: 'C' },
  { file: 'tel-aviv-walk-in-TL-0417.csv', loggerId: 'TL-0417', branch: 'Tel Aviv', fridge: 'Walk-in', unit: 'C', columns: { timestamp: 1, temperature: 0 } },
  { file: 'haifa-dairy-TL-0231.csv', loggerId: 'TL-0231', branch: 'Haifa', fridge: 'Dairy', unit: 'F' },
  { file: 'rishon-lezion-cream-cakes-TL-0388.csv', loggerId: 'TL-0388', branch: 'Rishon LeZion', fridge: 'Cream cakes', unit: 'C', columns: { timestamp: 1, temperature: 2 } },
  { file: 'tel-aviv-display-2-TL-0417.csv', loggerId: 'TL-0417', branch: 'tel aviv', fridge: 'Display 2', unit: 'C' },
  { file: 'jerusalem-display-TL-0520.csv', loggerId: 'TL-0520', branch: 'Jerusalem', fridge: 'Display', unit: 'C' },
] as const;

let db: Db;
let app: Express;

function upload(input: Partial<ImportInput> & Pick<ImportInput, 'content'>) {
  return importUpload(db, {
    filename: 'extra.csv',
    columns: { timestamp: 0, temperature: 1 },
    loggerId: 'TL-0512',
    branch: 'Jerusalem',
    fridge: 'Dairy',
    unit: 'C',
    ...input,
  });
}

beforeEach(() => {
  db = openDatabase(':memory:');
  app = createApp(db);
  for (const s of SAMPLES) {
    upload({
      filename: s.file,
      content: fs.readFileSync(path.join(sampleDir, s.file), 'utf8'),
      columns: 'columns' in s ? s.columns : { timestamp: 0, temperature: 1 },
      loggerId: s.loggerId,
      branch: s.branch,
      fridge: s.fridge,
      unit: s.unit,
    });
  }
});

async function fridgeId(branch: string, name: string): Promise<number> {
  const res = await request(app).get('/api/fridges');
  return res.body.find((f: { branch: string; name: string }) => f.branch === branch && f.name === name).id;
}

describe('GET /api/fridges', () => {
  it('returns every fridge with display names, ordered by branch and fridge', async () => {
    const res = await request(app).get('/api/fridges');
    expect(res.status).toBe(200);
    expect(res.body.map((f: { branch: string; name: string }) => `${f.branch} / ${f.name}`)).toEqual([
      'Haifa / Dairy',
      'Jerusalem / Dairy',
      'Jerusalem / Display',
      'Rishon LeZion / Cream cakes',
      'Tel Aviv / Display 2', // typed as "tel aviv", shown with the branch's first spelling
      'Tel Aviv / Walk-in',
    ]);
  });

  it('returns the Phase 5 status of each fridge', async () => {
    const res = await request(app).get('/api/fridges');
    const status = Object.fromEntries(
      res.body.map((f: { branch: string; name: string; status: string }) => [`${f.branch} / ${f.name}`, f.status]),
    );
    expect(status).toEqual({
      'Haifa / Dairy': 'ok',
      'Jerusalem / Dairy': 'gaps',
      'Jerusalem / Display': 'excursion', // recovered within the file — still an excursion (O1)
      'Rishon LeZion / Cream cakes': 'excursion',
      'Tel Aviv / Display 2': 'ok',
      'Tel Aviv / Walk-in': 'ok', // isolated spike only — not an excursion, not warming
    });
  });

  it('returns the latest reading of each fridge', async () => {
    const res = await request(app).get('/api/fridges');
    const haifa = res.body.find((f: { branch: string }) => f.branch === 'Haifa');
    expect(haifa).toEqual({
      id: expect.any(Number),
      branch: 'Haifa',
      name: 'Dairy',
      status: 'ok',
      latestReading: { recordedAt: '2026-09-14 23:45:00', temperatureC: 3.78 },
    });
  });

  it('returns [] for an empty database', async () => {
    const empty = createApp(openDatabase(':memory:'));
    const res = await request(empty).get('/api/fridges');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns status null and no latest reading for a fridge without readings', async () => {
    // A re-upload under another fridge stores no readings (all duplicates) but creates the fridge.
    upload({ content: fs.readFileSync(path.join(sampleDir, SAMPLES[0].file), 'utf8'), fridge: 'Spare' });
    const res = await request(app).get('/api/fridges');
    expect(res.body.find((f: { name: string }) => f.name === 'Spare')).toMatchObject({
      status: null,
      latestReading: null,
    });
  });
});

describe('GET /api/fridges/:id', () => {
  it('returns the fridge, its imports with findings, and its readings', async () => {
    const id = await fridgeId('Tel Aviv', 'Walk-in');
    const res = await request(app).get(`/api/fridges/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.fridge).toEqual({ id, branch: 'Tel Aviv', name: 'Walk-in' });
    expect(res.body.status).toBe('ok');
    expect(res.body.imports).toHaveLength(1);
    expect(res.body.imports[0]).toMatchObject({
      loggerId: 'TL-0417',
      filename: 'tel-aviv-walk-in-TL-0417.csv',
      unit: 'C',
      counts: { rows: 96, inserted: 96, invalid: 0, rejected: 0, duplicates: 0, conflicts: 0 },
    });
    expect(res.body.statusImportId).toBe(res.body.imports[0].id);
  });

  it('shows the Tel Aviv Walk-in spike but no excursion, and none of Display 2\'s readings', async () => {
    const res = await request(app).get(`/api/fridges/${await fridgeId('Tel Aviv', 'Walk-in')}`);
    const analysis = res.body.imports[0].analysis;
    expect(analysis.spikes).toMatchObject([{ at: '2026-09-14 06:15:00', temperatureC: 9.4 }]);
    expect(analysis.excursions).toEqual([]);
    expect(analysis.warming).toEqual([]); // the spike does not count as warming
    const times = res.body.readings.map((r: { recordedAt: string }) => r.recordedAt);
    expect(times).toHaveLength(96);
    expect(times).toEqual([...times].sort()); // 05:45, listed after 06:30 in the file, is back in order
    expect(times.slice(times.indexOf('2026-09-14 05:45:00'), times.indexOf('2026-09-14 05:45:00') + 2)).toEqual([
      '2026-09-14 05:45:00',
      '2026-09-14 06:00:00',
    ]);
    expect(times.every((t: string) => t.startsWith('2026-09-14'))).toBe(true); // none of Display 2's (17/09)
  });

  it('shows Rishon\'s ongoing excursion and warming', async () => {
    const res = await request(app).get(`/api/fridges/${await fridgeId('Rishon LeZion', 'Cream cakes')}`);
    expect(res.body.status).toBe('excursion');
    const analysis = res.body.imports[0].analysis;
    // Assignment rows 4.6 → 5.4 → 6.3 → 7.1 inside a longer rise; still above 5 °C at the end of the file.
    expect(analysis.excursions).toMatchObject([
      { startAt: '2026-09-14 06:15:00', endAt: null, ongoing: true, minutes: 165, peakC: 8.4 },
    ]);
    expect(analysis.warming).toMatchObject([
      { startAt: '2026-09-14 05:45:00', endAt: '2026-09-14 08:00:00', fromC: 4.5, toC: 8.2, riseC: 3.7 },
    ]);
  });

  it('shows the recovered excursion in Jerusalem / Display', async () => {
    const res = await request(app).get(`/api/fridges/${await fridgeId('Jerusalem', 'Display')}`);
    expect(res.body.status).toBe('excursion');
    expect(res.body.imports[0].analysis.excursions).toMatchObject([
      { startAt: '2026-09-14 13:45:00', endAt: '2026-09-14 15:15:00', minutes: 90, ongoing: false, peakC: 6.8 },
    ]);
  });

  it('returns raw and normalized values for every reading (Haifa °F + ERR)', async () => {
    const res = await request(app).get(`/api/fridges/${await fridgeId('Haifa', 'Dairy')}`);
    const at = (t: string) => res.body.readings.find((r: { recordedAt: string }) => r.recordedAt === t);
    expect(at('2026-09-14 06:00:00')).toMatchObject({
      loggerId: 'TL-0231', rawTimestamp: '14/09/2026 06:00', rawTemperature: '38.3', temperatureC: 3.5, invalidReason: null,
    });
    expect(at('2026-09-14 06:30:00')).toMatchObject({ rawTemperature: 'ERR', temperatureC: null, invalidReason: 'non-numeric value: ERR' });
  });

  it('keeps import boundaries: each import has its own findings and no gap is created between them', async () => {
    const id = await fridgeId('Jerusalem', 'Dairy');
    upload({ content: 'Time,Temp\n2026-09-21 06:00,6.0\n2026-09-21 06:15,4.0\n2026-09-21 06:30,4.1\n' });

    const res = await request(app).get(`/api/fridges/${id}`);
    const [week1, week2] = res.body.imports;
    expect(week1.analysis.gaps).toHaveLength(1); // the 06:15 → 08:30 gap inside the first file
    expect(week2.analysis.gaps).toEqual([]); // nothing between the two files
    // 6.0 is the first reading of its import, so it cannot be confirmed as a spike (O3).
    expect(week2.analysis.spikes).toEqual([]);
    expect(week2.analysis.excursions).toMatchObject([{ startAt: '2026-09-21 06:00:00' }]);
    // Status comes from the import with the latest readings (D3, O2) — a recovered excursion still counts (O1).
    expect(res.body.statusImportId).toBe(week2.id);
    expect(res.body.status).toBe('excursion');
  });

  it('lists an import that added no readings, with no analysis', async () => {
    const id = await fridgeId('Jerusalem', 'Dairy');
    upload({ content: fs.readFileSync(path.join(sampleDir, SAMPLES[0].file), 'utf8') });
    const res = await request(app).get(`/api/fridges/${id}`);
    expect(res.body.imports).toHaveLength(2);
    // 89 rows: 88 already stored + 1 repeated row inside the file.
    expect(res.body.imports[1]).toMatchObject({ counts: { rows: 89, inserted: 0, duplicates: 89 }, analysis: null });
    expect(res.body.status).toBe('gaps'); // unchanged by the duplicate-only upload (O2)
  });

  it('returns 404 for an unknown fridge', async () => {
    const res = await request(app).get('/api/fridges/999');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Fridge not found' });
  });

  it.each(['abc', '0', '-1', '1.5', '01', '1e2'])('returns 400 for the invalid id %j', async (bad) => {
    const res = await request(app).get(`/api/fridges/${bad}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid fridge id' });
  });
});

describe('findings are computed on read, not stored', () => {
  it('keeps only the three source tables and does not write when read', async () => {
    const tables = () =>
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
    const counts = () =>
      ['fridges', 'imports', 'readings'].map(
        (t) => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n,
      );
    const before = counts();

    await request(app).get('/api/fridges');
    await request(app).get(`/api/fridges/${await fridgeId('Rishon LeZion', 'Cream cakes')}`);

    expect(tables()).toEqual([{ name: 'fridges' }, { name: 'imports' }, { name: 'readings' }]);
    expect(counts()).toEqual(before);
  });

  it('reflects new readings immediately, with nothing to recompute', async () => {
    const id = await fridgeId('Haifa', 'Dairy');
    expect((await request(app).get(`/api/fridges/${id}`)).body.status).toBe('ok');

    upload({
      loggerId: 'TL-0231', branch: 'Haifa', unit: 'F',
      content: 'Time,Temp\n2026-09-21 06:00,40.0\n2026-09-21 06:15,45.0\n2026-09-21 06:30,46.0\n',
    });
    expect((await request(app).get(`/api/fridges/${id}`)).body.status).toBe('excursion');
  });
});
