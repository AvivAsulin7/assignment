/**
 * Imports the files in /sample-data through the normal import service.
 * Metadata below is what a user would type at upload. Safe to run repeatedly:
 * re-imports are counted as duplicates.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importUpload } from '../src/imports/service.js';
import { detectColumns, parseCsv } from '../src/parsing/index.js';
import { DEFAULT_DB_PATH, openDatabase } from '../src/persistence/db.js';

const sampleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../sample-data');

const uploads = [
  { file: 'jerusalem-dairy-TL-0512.csv', loggerId: 'TL-0512', branch: 'Jerusalem', fridge: 'Dairy', unit: 'C' },
  { file: 'tel-aviv-walk-in-TL-0417.csv', loggerId: 'TL-0417', branch: 'Tel Aviv', fridge: 'Walk-in', unit: 'C' },
  { file: 'haifa-dairy-TL-0231.csv', loggerId: 'TL-0231', branch: 'Haifa', fridge: 'Dairy', unit: 'F' },
  { file: 'rishon-lezion-cream-cakes-TL-0388.csv', loggerId: 'TL-0388', branch: 'Rishon LeZion', fridge: 'Cream cakes', unit: 'C' },
  // Same logger, moved to the new display fridge; branch typed in lower case as in Summer's sheet.
  { file: 'tel-aviv-display-2-TL-0417.csv', loggerId: 'TL-0417', branch: 'tel aviv', fridge: 'Display 2', unit: 'C' },
  // Made-up extra fridge: an afternoon excursion that recovers.
  { file: 'jerusalem-display-TL-0520.csv', loggerId: 'TL-0520', branch: 'Jerusalem', fridge: 'Display', unit: 'C' },
] as const;

const dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH;
const db = openDatabase(dbPath);
console.log(`Seeding ${dbPath}`);

for (const u of uploads) {
  const content = fs.readFileSync(path.join(sampleDir, u.file), 'utf8');
  const detection = detectColumns(parseCsv(content).headers);
  if (!detection.confident) throw new Error(`Columns not detected in ${u.file}`);

  const summary = importUpload(db, {
    filename: u.file,
    content,
    columns: { timestamp: detection.timestamp!, temperature: detection.temperature! },
    loggerId: u.loggerId,
    branch: u.branch,
    fridge: u.fridge,
    unit: u.unit,
  });
  console.log(`${u.file}: ${JSON.stringify(summary.counts)}`);
}

db.close();
