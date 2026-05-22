import express from 'express';
import { surveyStatsRouter } from '../../server/src/routes/survey-stats.routes.js';

// Dedicated function for /api/dashboard/*. The global catchall at
// api/[...path].ts can ship without dashboard routes registered when
// Vercel's import tracing gets confused; this sub-catchall mounts the
// router by filename so routing for the operator endpoints is deterministic.
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '64kb' }));
app.use('/api/dashboard', surveyStatsRouter);

export default app;
