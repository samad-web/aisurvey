# LexDraft Dashboard — Enhancement Spec

## Context

You're extending the dashboard in `lexdraft-survey` — a Vite + React 18 SPA backed by Express + Postgres. The dashboard lives at `/dashboard` (`src/views/DashboardView.tsx`), is gated by `x-dashboard-key`, and renders 9 sections of Recharts visualisations over aggregated, non-PII data from `GET /api/dashboard/stats`. Aggregation runs in-memory in Node (`server/src/services/survey-stats.service.ts`).

Design system: monochrome "Legal" — black on near-white, six-grey Recharts palette `#0A0A0A → #E5E5E5`, Inter for UI, Source Serif 4 for prose, JetBrains Mono for numerics. Tokens in `src/styles/tokens.css`, components in `src/styles/globals.css`.

**Hard constraints (do not violate):**
- PII never leaves the API. Never select `name`, `email`, `phone`, `city`, `ip_address`, `user_agent` in any new endpoint.
- The dashboard stays behind the existing `x-dashboard-key` gate. No new auth system, no per-user accounts.
- Reuse existing primitives only: `.card`, `.stat-row`, `.pill-nav`, `.chip`, `.tbl`, `.btn`, `.input`, `.badge`.
- Recharts only. No new charting libraries.
- Monochrome stays. No new colour accents — status colours (`--danger`, `--info`) are the only exception and only for banners.

The dashboard works today. Four gaps to close.

---

## 1. Cross-chart correlation

**Why.** Every chart today is a marginal distribution. The operator can see "30% are solo firms" and "45% use AI weekly" but can't see "of solos, what % use AI weekly?"

**Build.**
- **Cross-filter mode.** Clicking a slice/bar in any chart filters every other chart on the page to that subset. Click again to clear. Active filters render as `.chip` tokens above the KPI row with an "× clear all" affordance.
- **Pairwise heatmap.** A new section "Correlations" with a grid of `categorical × categorical` cells (counts; row-% on hover) for the analytically interesting pairs:
  - `firmSize × aiUsage`
  - `firmSize × willPay`
  - `practice × aiTools`
  - `years × switching`
  - `concern × cohort`

  Use the existing six-grey ramp — darker cell = higher share. Render with Recharts `Cell` or a hand-rolled SVG grid using the same tokens.

**Where the maths runs.** Client-side over a richer payload — see §5. No new aggregation endpoint in Phase 1.

**Acceptance.**
- Selecting "solo" on the cohort donut recomputes every other chart in <100 ms.
- Filters survive reload via URL query string (`?cohort=solo&aiUsage=weekly`).
- Multiple filters AND together (intersection, not union).

---

## 2. Date-range selector

**Why.** Timeseries is hard-coded to the last 30 days. Everything else aggregates over all time. There is no way to inspect a specific window.

**Build.**
- A `DateRangePicker` in the sticky header next to **Refresh** / **Sign out**.
- Two `.input` fields (date numerals in JetBrains Mono) plus a popover calendar built from scratch — **do not add a new dependency** unless `react-day-picker` or equivalent is already in `package.json`.
- Preset row above the calendar, rendered as `.pill-nav` tabs: `Last 7 days`, `Last 30 days`, `Last 90 days`, `All time`, `Custom`.
- The chosen window applies to **every** chart and to the KPI tiles — not just the timeseries.

**Backend.**
- Extend `GET /api/dashboard/stats` to accept `?from=YYYY-MM-DD&to=YYYY-MM-DD` (both optional; default = all time).
- Validate with Zod; reject non-ISO dates with 400.
- Filter `survey_responses` by `submitted_at` **at the SQL level** before in-memory bucketing. Do not load the whole table and filter in JS.
- Add migration `0003_survey_responses_submitted_at_idx.sql` if `submitted_at` is not already indexed.
- Echo `{ from, to }` back in the response so the client can confirm.

**Acceptance.**
- Range survives reload via URL (`?from=2025-01-01&to=2025-03-31`).
- "All time" sends no query params and returns today's payload shape unchanged.
- The 30-day timeseries auto-extends to the chosen window when wider than 30 days.

---

## 3. Role-based dashboard views

**Why.** Different stakeholders want different cuts. The CFO doesn't care about practice-area distribution; the CTO doesn't care about willingness-to-pay. Today everyone sees everything.

**Build.** A `.pill-nav` row directly under the sticky header with five tabs:

**Operator** (default) — current view, unchanged.

**CEO** — strategy snapshot
- KPIs: Total responses, Completion rate, % "would recommend ≥ 8/10", % solo + small (TAM proxy).
- Charts: cohort donut, top-3 weighted rankings, recommended Likert, follow-up funnel.

**CFO** — revenue & willingness-to-pay
- KPIs: Median spend (by cohort), Median willingness-to-pay (by cohort), top pricing-model slug, % "would switch".
- Charts: `spendByCohort` stacked bars, `willPayByCohort` stacked bars, pricing-model bar, switching bar.

**CTO** — tooling & integration
- KPIs: % using AI weekly+, % with case-management software, % e-filing, top-3 AI tools.
- Charts: AI usage bar, AI tools horizontal bars, case-mgmt + e-file bars, concerns radar.

**Investor** — traction & demand, with emphasis on current inputs
- KPIs: Total responses, % completion, last-30d submission velocity (sparkline), beta-Yes count, pilot-Yes count, founder-Yes count.
- Charts: 30-day timeseries (full-width), follow-up funnel, cohort donut, recommended Likert.
- **"Latest activity" panel** — a `.tbl` listing the last 20 submissions with timestamp + cohort + role slug (no PII, just slugs). Backend adds a `recentActivity: { submittedAt, cohort, role }[]` array to `DashboardStats`.

**Acceptance.**
- No new aggregation logic — every role view selects from the same `DashboardStats` payload (plus the new `recentActivity` for Investor).
- Active tab stored in URL (`?view=cfo`).
- Switching tabs is pure client-side re-mount; no extra API call.
- Each non-operator tab has its own ordered layout — do not just hide cards from the operator layout.

---

## 4. Category view

**Why.** The 9 sections today are ordered by survey-question order, not by analytical purpose. Users hunting for "everything about pricing" have to scroll past unrelated charts.

**Build.**
- A second `.pill-nav` row under the role tabs: **All** (default), **Audience**, **Practice**, **Tools & AI**, **Pricing**, **Concerns**, **Funnel**.
- Tag each existing `ChartCard` with a `category` prop. Selecting a category collapses the view to matching cards.
- Category state is independent of role state; both encoded in URL (`?view=cfo&category=pricing`).
- When a role tab is active, the category filter applies **within** that role's curated set — CFO + Pricing shows only CFO's pricing cards.

**Acceptance.**
- "Tools & AI" + Operator → `aiUsage`, `aiTools`, `stopReason`, `caseMgmt`, `efile`, `research`, `drafting`, `storage`.
- "Pricing" + CFO → `spendByCohort`, `willPayByCohort`, `pricingModel`, `switching`.
- Empty intersection → neutral "No charts in this category for this view" empty state inside a `.card`.

---

## 5. Backend changes summary

Single service: `server/src/services/survey-stats.service.ts` (+ route in `survey-stats.routes.ts`).

- Accept `from` / `to` query params; Zod-validated.
- SQL-level filter on `submitted_at`; add index migration if needed.
- Add `recentActivity: { submittedAt, cohort, role }[]` (last 20, no PII) to `DashboardStats`.
- Echo resolved `{ from, to }` in the payload.
- **Phase 2 only** (ship if client-side correlation is sluggish): add a `pairs` field:
  ```ts
  pairs?: {
    [pairKey: string]: { [aSlug: string]: { [bSlug: string]: number } }
  }
  // pairs['firmSize×aiUsage']['solo']['weekly'] = 42
  ```
  Compute only the five pairs in §1. Keep total response under 200 KB.

No other schema changes.

---

## 6. Out of scope (explicit)

- User accounts or per-user dashboards. Gate stays a shared secret.
- Real-time updates / WebSockets. Refresh stays manual.
- CSV / PDF export.
- Drilling into individual responses. Aggregates only; PII never.
- New colour accents. Monochrome stays.

---

## 7. Ship order

1. Date-range selector + SQL-level backend filter — smallest, unblocks everything.
2. `category` prop on `ChartCard` + category pill row.
3. Role-tab pill row + per-role layouts (+ `recentActivity` for Investor).
4. Cross-filter mode (client-side) on existing charts.
5. Pairwise heatmap — last, since it's the one piece that may force the `pairs` payload.

Ship 1–3 in PR 1 (filters + shell). Ship 4–5 in PR 2 (correlations).

---

## 8. Chart inventory — reference for detailed interactions

The five chart components in `DashboardView.tsx` today (`HorizontalBars`, `OrderedBars`, `CohortDonut`, `CohortStackedBars`, `ConcernRadar`) cover **marginal** distributions well but don't reveal **interactions** between variables. Below is the chart vocabulary for the relationship-focused work in §1, §3, §4. All are buildable with the existing Recharts dependency — no new libraries.

### 8.1 New chart types

| Chart | What it reveals | Data pairing | Recharts primitive | Lives in |
|---|---|---|---|---|
| **Sankey** | Multi-stage flow between categorical states. | `firmSize → aiUsage → willPay` (3 stages) | `Sankey` | Correlations, CEO |
| **Funnel** | Sequential conversion through a pipeline. | `followUps`: interview → beta → pilot → founder Yes | `FunnelChart` + `Funnel` | Investor |
| **Stacked area / streamgraph** | Composition over time. | 30-day `timeseries` stacked by `cohort` | `AreaChart` with `stackOffset="silhouette"` for streamgraph | Investor, Operator |
| **Heatmap (pairs)** | Joint distribution of two categoricals — counts + row-%. | The 5 pairs listed in §1 | Hand-rolled SVG grid using `--grey-*` tokens (or `Treemap` repurposed) | Correlations |
| **Bubble scatter** | 4-D relationship (x, y, size, shade). | x = `years`, y = `adminHours`, size = count, shade = avg `recommended` Likert | `ScatterChart` with `ZAxis` | CEO, CTO |
| **Bump chart** | Rank stability across groups. | Top `concern` ranked 1..N, one line per cohort | `LineChart` over rank-transformed data | CTO, Correlations |
| **Slope chart** | Two-state comparison; slope = headroom. | Median `spend` → median `willPay`, one line per cohort | `LineChart` with two x-values | CFO |
| **Treemap** | Nested proportional sizing. | `practice` sized by count, grouped by `cohort` | `Treemap` | Operator, CTO |
| **Small multiples grid** | Within-group detail across many groups side-by-side. | Same bar chart of `aiUsage` rendered 4× (one per cohort) | 4 × `BarChart` in a CSS grid | Correlations |
| **Brushed timeseries** | Drill into a time window without losing context. | 30-day `timeseries` with bottom brush | `LineChart` + `<Brush />` | Investor, Operator |
| **Composed chart** | Two metrics on the same time axis. | Bars = submissions/day, line = rolling 7-day completion rate | `ComposedChart` | Investor |

### 8.2 Interaction patterns (uniform across every chart)

These behaviours apply to all chart cards and are the implementation of "cross-filter mode" from §1:

- **Hover tooltip.** Counts + row-% + active filter context ("of solos: 42 / 138 = 30.4%"). Styled with `.card` shadow and `.body-sm` text.
- **Click to filter.** Clicking any slice / bar / cell / Sankey node / Funnel segment adds that value as a `.chip` filter. Click again to clear.
- **Linked highlighting.** When filters are active, every other chart on the page recomputes with the filtered subset; bars not in the filter dim to `--grey-200` rather than disappear (preserves spatial context).
- **Keyboard nav.** `Tab` focuses chart cards; arrow keys move between data points; `Enter` toggles the filter on the focused point. Uses the existing `.btn` focus-ring tokens.
- **URL persistence.** Every interaction encodes to the query string (`?cohort=solo&aiUsage=weekly&category=pricing&view=cfo&from=...&to=...`). Reload reproduces the exact view.
- **No animation on filter change.** Recharts' default enter/exit animation makes linked highlighting feel laggy — pass `isAnimationActive={false}` on every chart used in cross-filter mode.

### 8.3 Mapping to `DashboardStats` fields

For implementer reference — which payload feeds which new chart:

```
Sankey               ← cohort + aiUsage + willPayByCohort
Funnel               ← followUps.{interviewYes, betaYes, pilotYes, founderYes}
Streamgraph          ← timeseries × cohort                  ← payload extension
Heatmap (pairs)      ← see §5 Phase-2 `pairs` field
Bubble scatter       ← years + adminHours + recommended    ← compute client-side
Bump chart           ← concern × cohort                    ← derive from `pairs`
Slope chart          ← spendByCohort + willPayByCohort     (already in payload)
Treemap              ← practice × cohort                   ← payload extension
Small multiples      ← any chart × 4 cohorts               ← derive from `pairs`
Brushed timeseries   ← timeseries                          (already in payload)
Composed chart       ← timeseries + rolling completion-rate ← payload extension
```

The three payload extensions bundle into a single optional field, shipped alongside `pairs` in Phase 2 of §5:

```ts
interactions?: {
  timeseriesByCohort: { date: string; cohort: Cohort; count: number }[]
  practiceByCohort:   { practice: string; cohort: Cohort; count: number }[]
  completionRateTs:   { date: string; rate: number }[]
}
```

Keep the total payload under 200 KB. If `practiceByCohort` blows the budget, cap to top-15 practices.

### 8.4 What stays the same

The existing five chart components (`HorizontalBars`, `OrderedBars`, `CohortDonut`, `CohortStackedBars`, `ConcernRadar`) remain in service for marginal distributions on the Operator tab. The new components are **additive** — they appear in the Correlations section and on the role-specific tabs. Do not retrofit the existing charts to a new visual style; their role is the baseline view.

### 8.5 Per-tab chart assignment (consolidated)

To make §3 actionable with the new vocabulary:

| Tab | Marginal charts (existing) | Interaction charts (new) |
|---|---|---|
| **Operator** | All 9 sections, unchanged | Streamgraph, Treemap, Brushed timeseries |
| **CEO** | Cohort donut, rankings, recommended Likert | Sankey (cohort→AI→willPay), Bubble scatter |
| **CFO** | Spend stack, WillPay stack, pricing model bar, switching bar | Slope chart (spend→willPay) |
| **CTO** | AI usage bar, AI tools bars, case-mgmt + e-file, concerns radar | Bump chart (concern rank by cohort), Treemap (practice × cohort), Bubble scatter |
| **Investor** | 30-day timeseries, follow-up follow funnel, cohort donut, recommended Likert | Funnel (follow-ups), Streamgraph, Composed chart (volume + completion), Brushed timeseries, Latest activity table |
| **Correlations** | — | Heatmap (5 pairs), Sankey, Small multiples grid, Bump chart |
