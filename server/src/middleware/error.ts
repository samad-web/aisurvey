import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

// Single error handler. Zod errors come back as 400 with a flat issue list;
// everything else is logged + returned as 500. Public survey API so no
// internal stack traces in the response.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Server error' });
};
