import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { SCHEMA } from './schema.js';

export type Db = Database.Database;

// server/ — the same relative location from src/persistence (dev) and dist/persistence (built).
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Database file used by the server and the seed script unless DB_PATH is set. */
export const DEFAULT_DB_PATH = path.join(serverRoot, 'data', 'fridges.db');

/**
 * Opens (and creates if needed) the SQLite database and applies the schema.
 * Pass ':memory:' for an in-memory database (used by tests).
 */
export function openDatabase(filename: string): Db {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
