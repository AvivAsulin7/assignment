import fs from 'node:fs';
import path from 'node:path';
import express, { type ErrorRequestHandler } from 'express';
import { ImportError } from '../imports/service.js';
import { ColumnMappingError } from '../parsing/index.js';
import type { Db } from '../persistence/db.js';
import { fridgesRouter } from './fridges.js';
import { uploadsRouter } from './uploads.js';

export interface AppOptions {
  /** Directory with the built client app (client/dist). Served when it exists. */
  clientDistDir?: string;
}

/**
 * Maps errors to HTTP responses. Client mistakes get a 4xx with a readable
 * message; anything else is a 500 without internal details.
 */
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ImportError || err instanceof ColumnMappingError) {
    res.status(400).json({ error: err.message });
  } else if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body' });
  } else if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body too large' });
  } else {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Builds the Express app. Handlers stay thin and delegate to services
 * (see docs/architecture.md §3).
 */
export function createApp(db: Db, options: AppOptions = {}): express.Express {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.use('/api', uploadsRouter(db));
  app.use('/api', fridgesRouter(db));

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

  app.use(errorHandler);
  return app;
}
