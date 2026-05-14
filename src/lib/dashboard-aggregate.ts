// =============================================================================
// dashboard-aggregate - client-side bucket recomputation under cross-filter.
//
// Mirrors the server's aggregation logic in
// `server/src/services/survey-stats.service.ts` but runs over the non-PII
// `rows` array shipped in the API payload. When a cross-filter chip is
// active, the dashboard filters the row array and re-runs this aggregation
// in-place; the spec budget is <100ms for the worst case, which holds for
// row counts in the low thousands (it's all linear scans + Map increments).
// =============================================================================

import type { Cohort } from './survey-questions';

export interface BucketStat  { value: string;  count: number }
export interface CohortBucketStat { cohort: Cohort; value: string; count: number }
export interface TimeseriesPoint  { date: string; count: number }

export interface NonPiiResponse {
  firmSize: Cohort;
  role: string;
  years: string;
  barCouncil: string;
  language: string[];
  forum: string[];
  practice: string[];
  clients: string[];
  research: string[];
  drafting: string[];
  storage: string[];
  caseMgmt: string | null;
  efile: string[];
  rankings: string[];
  hurdle: string[];
  adminHours: string;
  aiUsage: string;
  aiTools: string[];
  stopReason: string[];
  spend: string;
  willPay: string;
  pricingModel: string[];
  switching: string[];
  concern: string[];
  dataLocation: string;
  recommended: string;
  interview: string | null;
  beta: string | null;
  pilot: string | null;
  founderCall: string | null;
  submittedAt: string;
}

/** Aggregates we recompute under cross-filter. Mirrors the bucket-bearing
 *  fields of `DashboardStats` on the server. */
export interface RecomputedAggregates {
  cohort: BucketStat[];
  role: BucketStat[];
  years: BucketStat[];
  barCouncil: BucketStat[];
  language: BucketStat[];
  forum: BucketStat[];
  practice: BucketStat[];
  clients: BucketStat[];
  research: BucketStat[];
  drafting: BucketStat[];
  storage: BucketStat[];
  caseMgmt: BucketStat[];
  efile: BucketStat[];
  rankingsWeighted: BucketStat[];
  hurdle: BucketStat[];
  adminHours: BucketStat[];
  aiUsage: BucketStat[];
  aiTools: BucketStat[];
  stopReason: BucketStat[];
  spendByCohort: CohortBucketStat[];
  willPayByCohort: CohortBucketStat[];
  pricingModel: BucketStat[];
  switching: BucketStat[];
  concern: BucketStat[];
  dataLocation: BucketStat[];
  recommended: BucketStat[];
  followUps: {
    interviewYes: number;
    betaYes: number;
    pilotYes: number;
    pilotMaybe: number;
    founderYes: number;
  };
  timeseries: TimeseriesPoint[];
  total: number;
}

// ---------------------------------------------------------------------------
// Field metadata: maps a filter key to (a) which NonPiiResponse field to
// read and (b) whether it's an array-valued column (multi-select).
// Used by both the cross-filter predicate and chart-click handlers so they
// agree on what 'practice' (array) vs 'cohort' (scalar) means.
// ---------------------------------------------------------------------------

type Single = { kind: 'single'; field: keyof NonPiiResponse };
type Array_ = { kind: 'array';  field: keyof NonPiiResponse };
type Meta = Single | Array_;

export const FIELD_META: Record<string, Meta> = {
  // Single-value
  cohort:       { kind: 'single', field: 'firmSize' },
  firmSize:     { kind: 'single', field: 'firmSize' },
  role:         { kind: 'single', field: 'role' },
  years:        { kind: 'single', field: 'years' },
  barCouncil:   { kind: 'single', field: 'barCouncil' },
  adminHours:   { kind: 'single', field: 'adminHours' },
  aiUsage:      { kind: 'single', field: 'aiUsage' },
  dataLocation: { kind: 'single', field: 'dataLocation' },
  recommended:  { kind: 'single', field: 'recommended' },
  caseMgmt:     { kind: 'single', field: 'caseMgmt' },
  spend:        { kind: 'single', field: 'spend' },
  willPay:      { kind: 'single', field: 'willPay' },

  // Multi-select
  language:     { kind: 'array', field: 'language' },
  forum:        { kind: 'array', field: 'forum' },
  practice:     { kind: 'array', field: 'practice' },
  clients:      { kind: 'array', field: 'clients' },
  research:     { kind: 'array', field: 'research' },
  drafting:     { kind: 'array', field: 'drafting' },
  storage:      { kind: 'array', field: 'storage' },
  efile:        { kind: 'array', field: 'efile' },
  hurdle:       { kind: 'array', field: 'hurdle' },
  aiTools:      { kind: 'array', field: 'aiTools' },
  stopReason:   { kind: 'array', field: 'stopReason' },
  pricingModel: { kind: 'array', field: 'pricingModel' },
  switching:    { kind: 'array', field: 'switching' },
  concern:      { kind: 'array', field: 'concern' },
  rankings:     { kind: 'array', field: 'rankings' },
};

// ---------------------------------------------------------------------------
// Cross-filter predicate. All active filters AND together (intersection).
// ---------------------------------------------------------------------------

export type FilterMap = Record<string, string>;

export function rowMatches(row: NonPiiResponse, filters: FilterMap): boolean {
  for (const [key, slug] of Object.entries(filters)) {
    if (!slug) continue;
    const meta = FIELD_META[key];
    if (!meta) continue; // unknown filter key - ignore, don't reject
    const v = row[meta.field];
    if (meta.kind === 'single') {
      if (v !== slug) return false;
    } else {
      if (!Array.isArray(v) || !v.includes(slug)) return false;
    }
  }
  return true;
}

export function applyFilters(rows: NonPiiResponse[], filters: FilterMap): NonPiiResponse[] {
  const active = Object.entries(filters).filter(([, v]) => v).length;
  if (active === 0) return rows;
  return rows.filter((r) => rowMatches(r, filters));
}

// ---------------------------------------------------------------------------
// Bucket helpers
// ---------------------------------------------------------------------------

function tally(into: Map<string, number>, key: string | null | undefined) {
  if (!key) return;
  into.set(key, (into.get(key) ?? 0) + 1);
}

function tallyArray(into: Map<string, number>, arr: readonly string[] | null | undefined) {
  if (!arr) return;
  for (const v of arr) tally(into, v);
}

function toBuckets(m: Map<string, number>): BucketStat[] {
  return [...m.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

function toCohortBuckets(m: Map<string, Map<string, number>>): CohortBucketStat[] {
  const out: CohortBucketStat[] = [];
  for (const [cohort, inner] of m.entries()) {
    for (const [value, count] of inner.entries()) {
      out.push({ cohort: cohort as Cohort, value, count });
    }
  }
  return out.sort((a, b) => (a.cohort < b.cohort ? -1 : a.cohort > b.cohort ? 1 : b.count - a.count));
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export function aggregate(rows: NonPiiResponse[], opts: {
  from?: string;
  to?: string;
} = {}): RecomputedAggregates {
  // ---- Single-value aggregators ----
  const cohort   = new Map<string, number>();
  const role     = new Map<string, number>();
  const years    = new Map<string, number>();
  const barCnl   = new Map<string, number>();
  const cmgmt    = new Map<string, number>();
  const adminH   = new Map<string, number>();
  const aiUsage  = new Map<string, number>();
  const dataLoc  = new Map<string, number>();
  const recomm   = new Map<string, number>();

  // ---- Multi-select aggregators ----
  const language  = new Map<string, number>();
  const forum     = new Map<string, number>();
  const practice  = new Map<string, number>();
  const clients   = new Map<string, number>();
  const research  = new Map<string, number>();
  const drafting  = new Map<string, number>();
  const storage   = new Map<string, number>();
  const efile     = new Map<string, number>();
  const hurdle    = new Map<string, number>();
  const aiTools   = new Map<string, number>();
  const stopR     = new Map<string, number>();
  const pricingM  = new Map<string, number>();
  const switching = new Map<string, number>();
  const concern   = new Map<string, number>();

  const rankingsWeighted = new Map<string, number>();

  const spendByCohort   = new Map<string, Map<string, number>>();
  const willPayByCohort = new Map<string, Map<string, number>>();
  const ensureInner = (m: Map<string, Map<string, number>>, k: string) => {
    let inner = m.get(k);
    if (!inner) { inner = new Map(); m.set(k, inner); }
    return inner;
  };

  let interviewYes = 0;
  let betaYes      = 0;
  let pilotYes     = 0;
  let pilotMaybe   = 0;
  let founderYes   = 0;

  // Timeseries window. Default trailing 30 days; widen if from/to demand it.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const tsEnd = opts.to ? new Date(`${opts.to}T00:00:00Z`) : today;
  const fallbackStart = new Date(tsEnd.getTime() - 29 * 86_400_000);
  const tsStart = opts.from ? new Date(`${opts.from}T00:00:00Z`) : fallbackStart;
  const totalDays = Math.min(
    365,
    Math.max(1, Math.floor((tsEnd.getTime() - tsStart.getTime()) / 86_400_000) + 1),
  );
  const days: TimeseriesPoint[] = [];
  const dayIdx = new Map<string, number>();
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(tsStart.getTime() + i * 86_400_000);
    const key = isoDay(d);
    dayIdx.set(key, days.length);
    days.push({ date: key, count: 0 });
  }

  for (const r of rows) {
    tally(cohort,  r.firmSize);
    tally(role,    r.role);
    tally(years,   r.years);
    tally(barCnl,  r.barCouncil);
    tally(cmgmt,   r.caseMgmt);
    tally(adminH,  r.adminHours);
    tally(aiUsage, r.aiUsage);
    tally(dataLoc, r.dataLocation);
    tally(recomm,  r.recommended);

    tallyArray(language,  r.language);
    tallyArray(forum,     r.forum);
    tallyArray(practice,  r.practice);
    tallyArray(clients,   r.clients);
    tallyArray(research,  r.research);
    tallyArray(drafting,  r.drafting);
    tallyArray(storage,   r.storage);
    tallyArray(efile,     r.efile);
    tallyArray(hurdle,    r.hurdle);
    tallyArray(aiTools,   r.aiTools);
    tallyArray(stopR,     r.stopReason);
    tallyArray(pricingM,  r.pricingModel);
    tallyArray(switching, r.switching);
    tallyArray(concern,   r.concern);

    for (let i = 0; i < r.rankings.length && i < 3; i++) {
      const w = 3 - i;
      const slug = r.rankings[i]!;
      rankingsWeighted.set(slug, (rankingsWeighted.get(slug) ?? 0) + w);
    }

    const spendInner   = ensureInner(spendByCohort,   r.firmSize);
    const willPayInner = ensureInner(willPayByCohort, r.firmSize);
    spendInner.set(r.spend, (spendInner.get(r.spend) ?? 0) + 1);
    willPayInner.set(r.willPay, (willPayInner.get(r.willPay) ?? 0) + 1);

    if (r.interview === 'yes')   interviewYes++;
    if (r.beta === 'yes')        betaYes++;
    if (r.pilot === 'yes')       pilotYes++;
    if (r.pilot === 'maybe')     pilotMaybe++;
    if (r.founderCall === 'yes') founderYes++;

    const day = isoDay(new Date(r.submittedAt));
    const idx = dayIdx.get(day);
    if (idx !== undefined) days[idx]!.count += 1;
  }

  return {
    cohort:           toBuckets(cohort),
    role:             toBuckets(role),
    years:            toBuckets(years),
    barCouncil:       toBuckets(barCnl),
    language:         toBuckets(language),
    forum:            toBuckets(forum),
    practice:         toBuckets(practice),
    clients:          toBuckets(clients),
    research:         toBuckets(research),
    drafting:         toBuckets(drafting),
    storage:          toBuckets(storage),
    caseMgmt:         toBuckets(cmgmt),
    efile:            toBuckets(efile),
    rankingsWeighted: toBuckets(rankingsWeighted),
    hurdle:           toBuckets(hurdle),
    adminHours:       toBuckets(adminH),
    aiUsage:          toBuckets(aiUsage),
    aiTools:          toBuckets(aiTools),
    stopReason:       toBuckets(stopR),
    spendByCohort:    toCohortBuckets(spendByCohort),
    willPayByCohort:  toCohortBuckets(willPayByCohort),
    pricingModel:     toBuckets(pricingM),
    switching:        toBuckets(switching),
    concern:          toBuckets(concern),
    dataLocation:     toBuckets(dataLoc),
    recommended:      toBuckets(recomm),
    followUps: {
      interviewYes,
      betaYes,
      pilotYes,
      pilotMaybe,
      founderYes,
    },
    timeseries: days,
    total:      rows.length,
  };
}
