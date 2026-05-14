import 'dotenv/config';

// Minimal env loader for the standalone survey server. Pulls from process.env
// (loaded via dotenv) and exposes a small, typed surface that the rest of
// the code reads.

const DATABASE_URL = process.env.DATABASE_URL ?? '';

export const env = {
  PORT: Number(process.env.PORT ?? 4000),
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  DATABASE_URL,
  hasDatabase: DATABASE_URL.length > 0,
  databaseSsl: process.env.DATABASE_SSL === 'true',
  // Comma-separated allowlist. Empty string = allow all origins (suitable
  // for local dev). In production set to https://your-survey-domain.
  corsOrigin: process.env.CORS_ORIGIN ?? '',
  // Per-IP rate limits. Tuned for a public survey: tight on submissions,
  // permissive on draft saves (a single respondent fires 30-60 PUTs).
  surveyLimitPerHour:      Number(process.env.SURVEY_LIMIT_PER_HOUR      ?? 10),
  surveyDraftLimitPerHour: Number(process.env.SURVEY_DRAFT_LIMIT_PER_HOUR ?? 120),
  // Shared-secret gate for /api/dashboard/stats. Empty => no gate (dev only).
  // Clients pass it as the `x-dashboard-key` header or `?key=` query param.
  dashboardKey:            process.env.DASHBOARD_KEY ?? '',
} as const;
