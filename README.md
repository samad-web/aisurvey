# LexDraft practitioner study

Standalone full-stack project for the LexDraft practitioner study:

- `./` - Vite SPA (the questionnaire UI)
- `./server` - Express + Postgres API (`/api/survey`, `/api/survey/drafts`)
- `./server/migrations` - SQL migrations (responses table + drafts table)
- `./docker-compose.yml` - one-command local stack (db + api + web)

No dependency on the main LexDraft monorepo - the entire app fits in this
repo and can be deployed on its own.

## Quick start (Docker)

```bash
docker compose up --build
# In another terminal, apply migrations the first time:
docker compose exec api npm run migrate
```

Open <http://localhost:8080>. The API listens on :4000 and Postgres on :5432.

## Manual dev (without Docker)

You need Node 18+ and a running Postgres.

```bash
# 1. API
cd server
cp .env.example .env
# edit .env, set DATABASE_URL
npm install
npm run migrate       # apply schema once
npm run dev           # http://localhost:4000

# 2. SPA (in a separate terminal)
cd ..
npm install
npm run dev           # http://localhost:5174
```

The Vite dev server proxies `/api/*` to `VITE_API_URL` (defaults to
`http://localhost:4000`).

## Build

```bash
# SPA
npm run build           # emits ./dist

# API
cd server
npm run build           # emits ./server/dist
```

## Endpoints

- `GET  /api/health` - liveness
- `GET  /api/ready` - liveness + Postgres ping
- `POST /api/survey` - submit final response (Zod-validated; DB CHECK-constrained)
- `POST /api/survey/drafts` - create anonymous draft, returns `{ id }`
- `PUT  /api/survey/drafts/:id` - update / mark draft completed

Rate limits (per IP, per hour): submissions 10, draft updates 120 (tunable
via `SURVEY_LIMIT_PER_HOUR` / `SURVEY_DRAFT_LIMIT_PER_HOUR`).

## Schema overview

`server/migrations/0001_survey_responses.sql` - one row per completed
submission. Columns are slug-typed with `CHECK` constraints on each
single-choice field and `jsonb_typeof / <@` shape+domain checks on each
multi-select. Cohort gates (e.g. `procurement` is large-only) live as
`CASE WHEN firm_size = 'large' THEN ...` constraints.

`server/migrations/0002_survey_drafts.sql` - anonymous in-progress drafts,
debounce-synced from the SPA. Lifetime is unbounded; add a TTL job later
if needed.

## Pushing to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

## Deployment notes

- The API needs a Postgres. RDS, Neon, and Supabase all work - set
  `DATABASE_URL` and `DATABASE_SSL=true` on managed services.
- Set `CORS_ORIGIN` to the SPA's deployed origin (or leave blank only in
  trusted internal environments).
- The SPA's `VITE_API_URL` is baked in at build time. Either:
  - Front both UI + API behind one reverse proxy (UI on `/`, API on `/api`)
    and leave `VITE_API_URL` empty, or
  - Deploy them on separate domains and pass
    `--build-arg VITE_API_URL=https://api.your-survey.example` when
    building the web image.
