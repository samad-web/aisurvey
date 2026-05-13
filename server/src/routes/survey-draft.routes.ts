import { Router } from 'express';
import { z } from 'zod';
import { surveyDraftService } from '../services/survey-draft.service.js';
import { validate, uuidParam } from '../middleware/validate.js';

// =============================================================================
// /api/survey/drafts - anonymous in-progress saves.
//
// Mounted publicly (no requireAuth) under a permissive limiter from
// routes/index.ts. Unlike POST /api/survey, drafts have no schema validation
// on individual fields - the client sends whatever partial state it has and
// we trust it because a malformed draft only ever poisons that one user's
// row (nothing joins to it, nothing exposes it to other users).
//
// Endpoints:
//   POST /api/survey/drafts        → create blank draft, returns { id }
//   PUT  /api/survey/drafts/:id    → overwrite the named fields on a draft
// =============================================================================

const DraftPatch = z.object({
  answers:      z.record(z.string(), z.unknown()).optional(),
  otherTexts:   z.record(z.string(), z.unknown()).optional(),
  currentIndex: z.number().int().min(-1).max(200).optional(),
  completed:    z.boolean().optional(),
});

export const surveyDraftRouter: Router = Router();

surveyDraftRouter.post('/', async (req, res, next) => {
  try {
    const ipAddress = req.ip ?? null;
    const userAgent = req.header('user-agent') ?? null;
    const result = await surveyDraftService.create({ ipAddress, userAgent });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

surveyDraftRouter.put(
  '/:id',
  validate({ params: uuidParam, body: DraftPatch }),
  async (req, res, next) => {
    try {
      const ok = await surveyDraftService.update(req.params['id'] as string, req.body);
      if (!ok) {
        res.status(404).json({ error: 'Draft not found' });
        return;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
