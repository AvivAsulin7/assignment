import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Db } from '../persistence/db.js';

export interface AppOptions {
  /** Directory with the built client app (client/dist). Served when it exists. */
  clientDistDir?: string;
}

/**
 * Builds the Express app. Routes are added in later phases; handlers stay thin
 * and delegate to services (see docs/architecture.md §3).
 */
export function createApp(db: Db, options: AppOptions = {}): express.Express {
  void db; // used by API routes from Phase 6a onwards

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Unknown API routes return JSON 404 rather than the SPA.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const { clientDistDir } = options;
  if (clientDistDir && fs.existsSync(path.join(clientDistDir, 'index.html'))) {
    app.use(express.static(clientDistDir));
    // SPA fallback so deep links like /fridges/3 work on reload.
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(clientDistDir, 'index.html'));
    });
  }

  return app;
}
