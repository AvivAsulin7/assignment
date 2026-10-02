import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './api/app.js';
import { DEFAULT_DB_PATH, openDatabase } from './persistence/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Same relative location from src/ (dev, via tsx) and dist/ (built).
const serverRoot = path.resolve(here, '..');
const clientDistDir = path.resolve(serverRoot, '../client/dist');

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH;

const db = openDatabase(dbPath);
const app = createApp(db, { clientDistDir });

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  console.log(`Database: ${dbPath}`);
});
