# LexDraft Survey — Architecture & Design

This document describes the two surfaces that make up `lexdraft-survey`:

1. **Survey** — the public, anonymous market-research questionnaire at `/` and `/survey`.
2. **Dashboard** — the operator view at `/dashboard` that visualises aggregated responses.

Both are served by a single Vite-built SPA backed by a small Express + Postgres API.

---

## 1. Repository layout

```
lexdraft-survey/
├─ src/                              ← React SPA (Vite)
│  ├─ App.tsx                        Route table: /, /survey, /dashboard
│  ├─ main.tsx                       React root + BrowserRouter
│  ├─ components/
│  │  └─ BackgroundBoxes.tsx         Aceternity-style hover grid behind the survey
│  ├─ lib/
│  │  ├─ api.ts                      Axios client + thin /api wrapper
│  │  ├─ survey-questions.ts         Single source of truth for question metadata
│  │  └─ survey-labels.ts            Slug → human-label maps for the dashboard
│  ├─ styles/
│  │  ├─ tokens.css                  Design tokens (colors, type, spacing, radii)
│  │  └─ globals.css                 Component classes (.card, .btn, .survey-…)
│  └─ views/
│     ├─ SurveyView.tsx              Multi-step questionnaire
│     └─ DashboardView.tsx           Passcode gate + charts
│
├─ server/                           ← Express + Postgres backend
│  ├─ src/
│  │  ├─ index.ts                    App bootstrap + route mounting
│  │  ├─ env.ts                      Typed process.env reader
│  │  ├─ db.ts                       Lazy postgres client
│  │  ├─ middleware/
│  │  │  ├─ validate.ts              Zod request validator
│  │  │  ├─ error.ts                 Single error handler
│  │  │  └─ rateLimit.ts             Per-IP rate limiters
│  │  ├─ routes/
│  │  │  ├─ survey.routes.ts         POST /api/survey (full submission)
│  │  │  ├─ survey-draft.routes.ts   POST/PUT /api/survey/drafts (autosave)
│  │  │  └─ survey-stats.routes.ts   GET /api/dashboard/stats (operator)
│  │  └─ services/
│  │     ├─ survey.service.ts        Insert into survey_responses
│  │     ├─ survey-draft.service.ts  Upsert into survey_drafts
│  │     └─ survey-stats.service.ts  Aggregate for dashboard
│  └─ migrations/
│     ├─ 0001_survey_responses.sql   Final-response table (strict CHECKs)
│     └─ 0002_survey_drafts.sql      Loose autosave table
│
├─ api/[...path].ts                  Vercel function shim re-exporting server app
├─ vite.config.ts                    Dev server on :5174, /api proxy to :4000
├─ Dockerfile / nginx.conf           Container build (SPA + static)
└─ ARCHITECTURE.md                   ← this file
```

---

## 2. Stack

| Layer        | Choice                                                                 |
|--------------|------------------------------------------------------------------------|
| Frontend     | React 18, Vite, TypeScript, Framer Motion, Recharts                    |
| Routing      | react-router-dom v6                                                    |
| HTTP         | axios (single shared client, no auth)                                  |
| Backend      | Express 4, helmet, cors, express-rate-limit, Zod                        |
| Database     | Postgres (via the `postgres` driver in Node)                            |
| Validation   | Zod (server) + DB `CHECK` constraints (defence-in-depth)                |
| Styling      | Plain CSS using design tokens; Tailwind preset present but minimal use  |
| Hosting      | Vercel (serverless via `api/[...path].ts`) or Docker (nginx + node)     |

The frontend bundles to a single SPA. The backend is mounted either as a Vercel serverless function (production) or a long-running Node process (`server/npm run dev` for local dev, `node dist/index.js` for container).

---

## 3. Survey — workflow

### 3.1 Question model

[`src/lib/survey-questions.ts`](src/lib/survey-questions.ts) is the single source of truth.

```
STEPS: StepDef[]   ←  10 functional steps (2..11)
  └─ StepDef
       ├─ index, title, helper
       ├─ fields: Field[]              ← rendered top-to-bottom
       └─ variants?: { cohorts, fields }[]   ← step 4 only

Field
  ├─ name           camelCase key in `answers`
  ├─ prompt         question text
  ├─ kind           text | email | tel | textarea | select | radio | checkbox | rankings
  ├─ required
  ├─ options?       Option[]    (radio / checkbox / select / rankings)
  ├─ hasOther       whether "Other" reveals a free-text input
  ├─ cohorts?       field-level cohort gate
  └─ maxPick?       cap on checkbox selections (e.g. practice areas: 5)

Cohort = 'solo' | 'small' | 'medium' | 'large'   ← derived from firmSize
```

#### Branching

Three independent branching axes, all centralised in `survey-questions.ts`:

| Axis                | Where it's defined                              | Examples                                  |
|---------------------|--------------------------------------------------|-------------------------------------------|
| **Cohort**          | `Field.cohorts`, `Option.cohorts`, `step4FieldsFor` | `procurement` for `large` only            |
| **AI usage path**   | `isFieldVisible()` switch on `aiUsage`           | `aiTools` only if `daily/weekly/occasional/stopped` |
| **Case-mgmt reveal**| `isFieldVisible()` switch on `caseMgmt`          | `caseMgmtSpec` only if `caseMgmt === 'yes'` |

Cohort-templated option lists (`SPEND_BY_COHORT`, `WILL_PAY_BY_COHORT`) are injected at render time by `FieldRow` in `SurveyView`.

### 3.2 Rendering pipeline (`src/views/SurveyView.tsx`)

```
                            ┌─────────────────────────┐
                            │  STEPS (declarative)    │
                            └────────────┬────────────┘
                                         │
                          fieldsForStep + isFieldVisible
                                         │
                                         ▼
                          ┌──────────────────────────────┐
                          │   visibleEntries: Entry[]    │
                          │   one entry per screen       │
                          └──────────────┬───────────────┘
                                         │
                  ──────────────────────────────────────────
                  │ GROUPED_STEPS (2,3,4,11) → multi-field │
                  │ FIELD_GROUPS pairs       → multi-field │
                  │ everything else          → one field   │
                  ──────────────────────────────────────────
                                         │
                                         ▼
                          currentIndex ────────────►  Welcome | FieldRow(s) | ThankYou
```

- `visibleEntries` is recomputed whenever `answers` change so the flow expands/contracts as branches open. The respondent's "position" is an index into this dynamic list — when the list shape changes, position naturally tracks.
- The Welcome screen is index `-1`. The Thank-you screen replaces the question card inline after `POST /api/survey` succeeds (no `/survey/thanks` navigation).
- The numbered pager (`StepsPager`) only renders indices the user has reached — the total step count is hidden upfront to avoid intimidation. The active number is anchored mid-row with a sliding framer-motion `layoutId="survey-step-pill"`.

### 3.3 Draft persistence — autosave

Two layers, debounced 800 ms:

1. **Server-side draft** — a row in `survey_drafts` allocated on first interaction past Welcome (`POST /api/survey/drafts`). Subsequent `PUT /api/survey/drafts/:id` snapshots the answers + position. On submit, marked `completed_at`.
2. **localStorage mirror** — same shape, key `lexdraft-survey-draft-v1`. Used to restore mid-survey state if the page reloads before the next debounced PUT lands.

```
user types ─► setAnswer ─► state changes
                                │
                                ▼ 800ms debounce
                        useEffect schedules a flush
                                │
                                ▼
                ┌────────────────────────────────┐
                │  saveLocalDraft(...) ──► localStorage │
                │  PUT /api/survey/drafts/:id   │
                └────────────────────────────────┘
                                │
                                ▼ on 404 / 500
                  draftIdRef.current = null   ← let next interaction re-allocate
                  clearLocalDraft()
```

### 3.4 Three layers of validation

A malformed client cannot poison the responses table:

| Layer    | File                                | What it does                                 |
|----------|--------------------------------------|----------------------------------------------|
| Form     | `firstMissingRequired` / `validateAllRequired` in `SurveyView.tsx` | Inline error on Continue / Submit |
| API      | `SurveyInput` Zod schema in `survey.routes.ts` | Slug enums, cohort-spend gates, branching cohort gates |
| Database | `CHECK` constraints in `0001_survey_responses.sql` | Same slug domains + branching as a last line |

### 3.5 Submission

```
goNext (last question)
   └─► validateAllRequired
   └─► buildPayload   (strips hidden fields + empty values)
   └─► POST /api/survey
        ├─► Zod → 400 (recoverable, banner)
        └─► insert into survey_responses → { id }
              └─► PUT /api/survey/drafts/:id { completed: true }
              └─► setSubmitted(true)  → ThankYouPanel
```

---

## 4. Dashboard — workflow

### 4.1 Route gate

`/dashboard` mounts [`DashboardView`](src/views/DashboardView.tsx). On first visit the component is in `key === null` state and renders `PasscodeGate`. The gate POSTs `GET /api/dashboard/stats` with the candidate key in the `x-dashboard-key` header:

- `401` → "Incorrect passcode" banner.
- `2xx` → cache the key in `localStorage` (`lexdraft-dashboard-key-v1`), swap to `DashboardContent`.

Sign-out clears the localStorage key.

### 4.2 Aggregation pipeline

```
DashboardView (key set)
   │
   ▼
 GET /api/dashboard/stats              ← header: x-dashboard-key
   │
   ▼
 surveyStatsRouter.get('/stats')        ← server/src/routes/survey-stats.routes.ts
   │  validate header  vs  env.dashboardKey
   ▼
 surveyStatsService.build()             ← server/src/services/survey-stats.service.ts
   │
   ├─ select non-PII columns from survey_responses
   ├─ select counts from survey_drafts (best-effort)
   └─ JS-side aggregation into bucket maps
         │
         ▼
   DashboardStats JSON  →  setStats()  →  charts
```

### 4.3 What the endpoint returns

The aggregation deliberately **returns no PII** — only counts and distributions. The response shape:

```ts
DashboardStats {
  generatedAt: string
  responses: {
    total, draftsTotal, draftsAbandoned, completionRate, last30Days
  }
  cohort, role, years, barCouncil,
  language, forum, practice, clients,
  research, drafting, storage, caseMgmt, efile,
  rankingsWeighted,    ← top-3 weighted 3/2/1
  hurdle, adminHours,
  aiUsage, aiTools, stopReason,
  spendByCohort, willPayByCohort,   ← CohortBucketStat[]
  pricingModel, switching,
  concern, dataLocation, recommended,
  followUps: { interviewYes, betaYes, pilotYes, pilotMaybe, founderYes }
  timeseries: { date: 'YYYY-MM-DD', count: number }[]   ← last 30 days
}
```

Each `BucketStat = { value, count }` is pre-sorted descending by count so the dashboard can render top-N slices without re-sorting.

### 4.4 Why JS aggregation

The aggregation runs in Node, not SQL, because:

- The non-PII columns fit comfortably in memory at the scale of a market-research study (thousands of rows, ~1 KB / row).
- Multi-select aggregation across `jsonb` arrays in SQL would require `LATERAL jsonb_array_elements`, which is harder to read than a JS `for` loop.
- Adding new bucket types is a one-line change in `survey-stats.service.ts`, no migration needed.

If response volume ever pushes this past ~10k rows, the natural migration is to push each bucket into a materialised view refreshed on submit.

### 4.5 Rendering

```
DashboardLayout
├─ Sticky header (timestamp + Refresh / Sign out)
├─ KpiRow                                    ← .stat-row from globals.css
└─ Section[] (9 of them)
   └─ ChartCard[]  (1+ per section)
      └─ ResponsiveContainer
         └─ Recharts primitive
            (BarChart | LineChart | PieChart | RadarChart)
```

Chart components are defined inline at the bottom of `DashboardView.tsx`:

| Component             | Used for                                                  |
|-----------------------|-----------------------------------------------------------|
| `HorizontalBars`      | Long category lists (practice, forums, research tools)    |
| `OrderedBars`         | Ordinal categoricals (years, admin hours, Likert recommended) |
| `CohortDonut`         | Firm-size split                                           |
| `CohortStackedBars`   | Spend / willingness-to-pay broken down by cohort          |
| `ConcernRadar`        | Top-8 concerns as % share, spider chart                   |
| `LineChart` (inline)  | 30-day submission timeseries                              |

### 4.6 Slug → label mapping

[`src/lib/survey-labels.ts`](src/lib/survey-labels.ts) walks `STEPS` at module load and builds a `Record<field, Record<slug, label>>`. The dashboard calls `labelFor('practice', 'civil') → 'Civil Litigation'`. Cohort-templated options (`spend`, `willPay`) are folded across cohorts so any slug resolves to a label.

Display order for ordinal scales (years 0-2 < 3-5 < … < 20+) is also exported from this file as plain arrays — Recharts uses them to lay out X-axes in the natural sort order rather than alphabetical.

---

## 5. API surface

All endpoints are mounted under `/api` in [`server/src/index.ts`](server/src/index.ts).

| Endpoint                            | Method | Auth                   | Rate limit              |
|-------------------------------------|--------|------------------------|-------------------------|
| `/api/health`                       | GET    | none                   | none                    |
| `/api/ready`                        | GET    | none                   | none                    |
| `/api/survey/drafts`                | POST   | none                   | 120 / hour / IP         |
| `/api/survey/drafts/:id`            | PUT    | none                   | 120 / hour / IP         |
| `/api/survey`                       | POST   | none                   | 10 / hour / IP          |
| `/api/dashboard/stats`              | GET    | `x-dashboard-key`      | 300 / hour / IP         |

Notes:

- Order matters: `/api/survey/drafts` mounts **before** `/api/survey` so the more specific path wins.
- The dashboard's gate is a shared secret in `env.dashboardKey`, compared via exact string match. Empty env means "no gate" (dev only).
- The dashboard endpoint sets `Cache-Control: no-store` so proxies don't cache operator data.

---

## 6. Database schema

Two tables, both defined in `server/migrations/`.

### 6.1 `survey_responses` (final submissions)

- **One row per submission.**
- Strict `CHECK` constraints mirror the slug enums in `survey.routes.ts` and `survey-questions.ts`.
- Multi-select questions stored as `jsonb` arrays with both shape (`jsonb_array_length >= 1`) and domain (`<@ '["…","…"]'::jsonb`) checks.
- Cohort-gated columns enforce branching at DB level:

```sql
constraint survey_procurement_cohort check (
  case when firm_size = 'large' then true else procurement is null end
)
```

- "Other" free-text answers all live in one `other_texts jsonb` column keyed by field name, instead of one column per question.

### 6.2 `survey_drafts` (autosave)

- Intentionally loose — no CHECK constraints beyond `jsonb_typeof = 'object'`.
- `completed_at` is stamped on successful submit so analytics can distinguish abandoned vs completed funnels without joining tables.
- Indexed by `updated_at desc` and a partial index `where completed_at is null` for abandonment queries.

---

## 7. Design system

[`src/styles/tokens.css`](src/styles/tokens.css) + [`src/styles/globals.css`](src/styles/globals.css) implement a monochrome "Legal" design system:

- **Palette** — black text (`--text-primary: #0A0A0A`) on near-white surfaces (`--bg-base: #FAFAFA`). Status colours exist (`--danger`, `--info`, etc.) but UI chrome stays grey. Dark theme is a single `[data-theme='dark']` override block.
- **Typography** — Inter for UI/display, Source Serif 4 for court-prose, JetBrains Mono for numerics. Class set: `.display-xl/lg/md`, `.heading-xl/lg/md/sm`, `.body-lg/md/sm/xs`, `.eyebrow`, `.mono`.
- **Components** — `.card`, `.card-cream`, `.btn`, `.btn-primary`, `.btn-lg`, `.input`, `.label`, `.stat-row`, `.pill-nav`, `.chip`, `.badge`, `.tbl`. The dashboard uses the same primitives.
- **Survey-specific** — `.survey-page`, `.survey-shell`, `.survey-card`, `.survey-nav`, `.survey-steps`, `.survey-fields` (multi-column packing), `.survey-options` (option tile grid).

Recharts is themed by passing tokens as `stroke`/`fill` props. The palette (`PALETTE` in `DashboardView.tsx`) is six greys — `#0A0A0A → #E5E5E5` — used in pie slices and stacked bars so the dashboard stays strictly monochrome.

---

## 8. Local development

```
# terminal 1 — backend
cd server
npm install
npm run migrate        # creates survey_responses + survey_drafts
npm run dev            # → http://localhost:4000

# terminal 2 — frontend
npm install
npm run dev            # → http://localhost:5174  (proxies /api → :4000)
```

`server/.env`:

```ini
DATABASE_URL=postgres://user:pass@host:5432/lexdraft_survey
DATABASE_SSL=false
PORT=4000

# optional
SURVEY_LIMIT_PER_HOUR=10
SURVEY_DRAFT_LIMIT_PER_HOUR=120
CORS_ORIGIN=http://localhost:5174

# dashboard gate (leave empty for no gate in dev)
DASHBOARD_KEY=<your-secret>
```

Frontend `.env.local` (optional — defaults to relative `/api` via Vite proxy):

```ini
VITE_API_URL=http://localhost:4000
```

---

## 9. Deployment

Two supported modes:

- **Vercel** — `api/[...path].ts` re-exports the Express app; Vercel runs it as a serverless function. Frontend ships as static assets. Set `DATABASE_URL`, `DATABASE_SSL=true`, `DASHBOARD_KEY` in the project's env panel.
- **Docker** — `Dockerfile` builds the SPA into `dist/`; `nginx.conf` serves it and proxies `/api` to a Node process running `node dist/index.js`. The container holds a long-lived `postgres` client (`server/src/db.ts`).

The backend trusts exactly one proxy hop (`app.set('trust proxy', 1)`) so `X-Forwarded-For` from the edge is honoured but no further — required by `express-rate-limit` to keep per-IP limits enforceable.

---

## 10. Design principles & non-goals

- **No auth on the public surfaces.** The survey is anonymous; the dashboard's only gate is a shared secret. There is intentionally no user system, no email verification, no session store.
- **Three lines of defence on data shape.** Form → Zod → CHECK. Each layer mirrors the others; the DB is canonical.
- **One question per screen by default.** Steps 2/3/4/11 are exceptions where the questions belong logically together. Long option lists collapse to multi-column packing at ≥280px columns.
- **Progressive disclosure.** The total step count is hidden upfront. The numbered pager grows as the respondent advances.
- **Monochrome aesthetic.** Colour is reserved for status (danger banners). Charts use greys. No brand accent.
- **PII never leaves the API.** The dashboard endpoint hand-picks non-identifying columns; `name`, `email`, `phone`, `city`, `ip_address`, `user_agent` are never selected.
- **No automated jobs.** No cron, no queue, no email — operator manually checks the dashboard. Adding automation is a separate decision.

---

## 11. File reference

Survey:

- [src/views/SurveyView.tsx](src/views/SurveyView.tsx) — multi-step wizard
- [src/lib/survey-questions.ts](src/lib/survey-questions.ts) — question metadata
- [src/components/BackgroundBoxes.tsx](src/components/BackgroundBoxes.tsx) — hero grid
- [server/src/routes/survey.routes.ts](server/src/routes/survey.routes.ts) — submission validator
- [server/src/routes/survey-draft.routes.ts](server/src/routes/survey-draft.routes.ts) — autosave endpoints
- [server/src/services/survey.service.ts](server/src/services/survey.service.ts) — insert
- [server/src/services/survey-draft.service.ts](server/src/services/survey-draft.service.ts) — upsert
- [server/migrations/0001_survey_responses.sql](server/migrations/0001_survey_responses.sql)
- [server/migrations/0002_survey_drafts.sql](server/migrations/0002_survey_drafts.sql)

Dashboard:

- [src/views/DashboardView.tsx](src/views/DashboardView.tsx) — passcode gate + charts
- [src/lib/survey-labels.ts](src/lib/survey-labels.ts) — slug → label maps
- [server/src/routes/survey-stats.routes.ts](server/src/routes/survey-stats.routes.ts) — gated GET
- [server/src/services/survey-stats.service.ts](server/src/services/survey-stats.service.ts) — aggregation

Shared:

- [src/lib/api.ts](src/lib/api.ts) — axios client + helpers
- [src/styles/tokens.css](src/styles/tokens.css) + [src/styles/globals.css](src/styles/globals.css) — design system
- [server/src/index.ts](server/src/index.ts) — app bootstrap, route mounting, rate limits
- [server/src/middleware/error.ts](server/src/middleware/error.ts) — 400 (Zod) / 500 fallback
