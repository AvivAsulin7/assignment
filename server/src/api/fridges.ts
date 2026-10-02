import { Router } from 'express';
import { getFridgeDetail, listFridgeOverviews } from '../fridges/service.js';
import type { Db } from '../persistence/db.js';

/** Fridge endpoints. Handlers only validate and delegate (architecture §3). */
export function fridgesRouter(db: Db): Router {
  const router = Router();

  router.get('/fridges', (_req, res) => {
    res.json(listFridgeOverviews(db));
  });

  router.get('/fridges/:id', (req, res) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) {
      res.status(400).json({ error: 'Invalid fridge id' });
      return;
    }
    const detail = getFridgeDetail(db, Number(req.params.id));
    if (!detail) {
      res.status(404).json({ error: 'Fridge not found' });
      return;
    }
    res.json(detail);
  });

  return router;
}
