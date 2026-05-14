import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { validate } from '../middleware/validate.js';
import { surveyStatsService } from '../services/survey-stats.service.js';

// =============================================================================
// /api/dashboard/stats - aggregated survey results for the operator view.
//
// Gated by a shared-secret header (`x-dashboard-key`) or query param (`?key=`).
// If DASHBOARD_KEY is unset in env, the gate is open (dev only). The endpoint
// returns NO PII: only counts, distributions, and a non-identifying row
// snapshot for client-side cross-filtering.
//
// Query params:
//   ?from=YYYY-MM-DD   inclusive lower bound on submitted_at
//   ?to=YYYY-MM-DD     inclusive upper bound on submitted_at
//   ?key=<secret>      alternative to the x-dashboard-key header
// =============================================================================

export const surveyStatsRouter: Router = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

const StatsQuery = z
  .object({
    from: isoDate.optional(),
    to:   isoDate.optional(),
    key:  z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.from && v.to && v.from > v.to) {
      ctx.addIssue({
        code: 'custom',
        path: ['from'],
        message: '`from` must be on or before `to`.',
      });
    }
  });

function unauthorized(res: import('express').Response) {
  res.status(401).json({ error: 'Unauthorized' });
}

function checkKey(req: import('express').Request): boolean {
  const expected = env.dashboardKey;
  if (!expected) return true; // dev: open
  const got = (req.header('x-dashboard-key') as string | undefined)
    ?? (typeof req.query.key === 'string' ? req.query.key : undefined);
  return Boolean(got) && got === expected;
}

surveyStatsRouter.get('/stats', validate({ query: StatsQuery }), async (req, res, next) => {
  try {
    if (!checkKey(req)) { unauthorized(res); return; }
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to   = typeof req.query.to   === 'string' ? req.query.to   : undefined;
    const stats = await surveyStatsService.build({ from, to });
    // Operator dashboard data shouldn't be cached by intermediaries.
    res.setHeader('Cache-Control', 'no-store');
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

// =============================================================================
// DELETE /api/dashboard/data - wipe every row from survey_responses and
// survey_drafts. Destructive and irreversible.
//
// Two locks beyond the standard x-dashboard-key check:
//   1. Method must be DELETE (no GET-by-mistake).
//   2. Body must include { confirm: "DELETE ALL" } verbatim. The client UI
//      asks the operator to type this string before the action enables, so
//      a stolen browser session can't fire it without an extra step.
// =============================================================================

const PurgeBody = z.object({
  confirm: z.literal('DELETE ALL'),
});

surveyStatsRouter.delete('/data', validate({ body: PurgeBody }), async (req, res, next) => {
  try {
    if (!checkKey(req)) { unauthorized(res); return; }
    const result = await surveyStatsService.purgeAll();
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});
