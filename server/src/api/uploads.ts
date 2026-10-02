import { Router } from 'express';
import { importUpload, previewUpload } from '../imports/service.js';
import type { Db } from '../persistence/db.js';
import { isColumns, isString } from '../utils/validation.js';

/** Upload endpoints. Handlers only validate and delegate (architecture §3). */
export function uploadsRouter(db: Db): Router {
  const router = Router();

  router.post('/uploads/preview', (req, res) => {
    const body = req.body ?? {};
    if (
      !isString(body.filename) ||
      !isString(body.content) ||
      (body.columns !== undefined && !isColumns(body.columns))
    ) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    res.json(previewUpload(body.content, body.columns));
  });

  router.post('/imports', (req, res) => {
    const body = req.body ?? {};
    if (
      ![body.filename, body.content, body.loggerId, body.branch, body.fridge].every(isString) ||
      (body.unit !== 'C' && body.unit !== 'F') ||
      !isColumns(body.columns)
    ) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    const { filename, content, columns, loggerId, branch, fridge, unit } = body;
    res.status(201).json(importUpload(db, { filename, content, columns, loggerId, branch, fridge, unit }));
  });

  return router;
}
