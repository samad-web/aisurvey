import rateLimit from 'express-rate-limit';
import { env } from '../env.js';

const HOUR_MS = 60 * 60 * 1000;

// Tight limit on full submissions - one IP shouldn't be able to flood the
// responses table.
export const surveyLimiter = rateLimit({
  windowMs: HOUR_MS,
  limit: env.surveyLimitPerHour,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many submissions. Please try again later.' },
});

// Permissive limit on draft autosaves. A single respondent typically fires
// 30-60 PUTs across a session as the debounced sync flushes their edits.
export const surveyDraftLimiter = rateLimit({
  windowMs: HOUR_MS,
  limit: env.surveyDraftLimitPerHour,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many draft updates. Please try again later.' },
});
