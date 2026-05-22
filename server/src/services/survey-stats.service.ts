import { db } from '../db.js';

// =============================================================================
// survey-stats.service - aggregate survey responses for the /dashboard view.
//
// Returns no PII. Fetches the non-identifying columns once and aggregates
// in JS (cleaner than 25 round-trips); for response counts in the low
// thousands this is comfortably fast.
//
// Accepts an optional date range (from/to, inclusive). At the SQL level we
// filter on submitted_at so the in-memory passes only see the windowed set;
// `survey_responses_submitted_at_idx` already exists in migration 0001.
//
// The payload also includes:
//   - `responses` (non-PII row array) so the client can recompute aggregates
//     in <100ms when a cross-filter is active, without a new round-trip.
//   - `recentActivity` (last 20) for the Investor tab.
// =============================================================================

type Cohort = 'solo' | 'small' | 'medium' | 'large';

interface Row {
  firm_size: Cohort;
  role: string;
  years: string;
  bar_council: string;
  language: string[] | null;
  forum: string[] | null;
  practice: string[] | null;
  clients: string[] | null;
  research: string[] | null;
  drafting: string[] | null;
  storage: string[] | null;
  case_mgmt: string | null;
  case_mgmt_spec: string | null;
  efile: string[] | null;
  pain_open: string;
  rankings: string[] | null;
  hurdle: string[] | null;
  admin_hours: string;
  ai_usage: string;
  ai_tools: string[] | null;
  stop_reason: string[] | null;
  ai_wants: string;
  ai_wish: string | null;
  firm_departments: string | null;
  spend: string;
  will_pay: string;
  pricing_model: string[] | null;
  switching: string[] | null;
  concern: string[] | null;
  data_location: string;
  recommended: string;
  interview: string | null;
  beta: string | null;
  pilot: string | null;
  founder_call: string | null;
  submitted_at: Date;
}

export interface BucketStat {
  value: string;
  count: number;
}

export interface CohortBucketStat {
  cohort: Cohort;
  value: string;
  count: number;
}

export interface TimeseriesPoint {
  date: string; // yyyy-mm-dd
  count: number;
}

/** Camel-cased, non-PII snapshot of a single survey_responses row. The
 *  client uses this array to recompute aggregates under cross-filter and
 *  to render the "voice of the customer" free-text panel.
 *
 *  Free-text fields (`painOpen`, `aiWants`, `aiWish`, `firmDepartments`,
 *  `caseMgmtSpec`) are user-typed prose. The survey is anonymous so they
 *  shouldn't contain hard PII like email/phone, but respondents may
 *  occasionally include a firm name or location. The dashboard gate
 *  (DASHBOARD_KEY) is what keeps this from leaking. */
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
  caseMgmtSpec: string | null;
  efile: string[];
  painOpen: string;
  rankings: string[];
  hurdle: string[];
  adminHours: string;
  aiUsage: string;
  aiTools: string[];
  stopReason: string[];
  aiWants: string;
  aiWish: string | null;
  firmDepartments: string | null;
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
  submittedAt: string; // ISO
}

export interface RecentActivityRow {
  submittedAt: string; // ISO
  cohort: Cohort;
  role: string;
}

export interface DashboardStats {
  generatedAt: string;
  filters: { from: string | null; to: string | null };
  responses: {
    total: number;
    draftsTotal: number;
    draftsAbandoned: number;
    completionRate: number; // 0..1
    last30Days: number;
  };
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
  rankingsWeighted: BucketStat[]; // weighted 3/2/1 by rank position
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
  timeseries: TimeseriesPoint[]; // window-aware daily counts
  rows: NonPiiResponse[];          // for client-side cross-filter
  recentActivity: RecentActivityRow[]; // last 20 in window
}

function tally(into: Map<string, number>, key: string | null | undefined) {
  if (!key) return;
  into.set(key, (into.get(key) ?? 0) + 1);
}

function tallyArray(into: Map<string, number>, arr: string[] | null | undefined) {
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

export interface BuildOpts {
  /** Inclusive lower bound, ISO date (yyyy-mm-dd). */
  from?: string;
  /** Inclusive upper bound, ISO date (yyyy-mm-dd). */
  to?: string;
}

/** Result of a destructive purge - row counts removed from each table. */
export interface PurgeResult {
  responsesDeleted: number;
  draftsDeleted: number;
}

export const surveyStatsService = {
  /** Delete every row from survey_responses and survey_drafts. Caller MUST
   *  enforce the auth + confirmation gate before invoking; this method does
   *  not re-validate. Returns the per-table counts so the operator UI can
   *  surface what was wiped. */
  async purgeAll(): Promise<PurgeResult> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');

    const r1 = await sql<{ count: string }[]>`
      with deleted as (
        delete from survey_responses returning 1
      )
      select count(*)::text as count from deleted
    `;
    let draftsDeleted = 0;
    try {
      const r2 = await sql<{ count: string }[]>`
        with deleted as (
          delete from survey_drafts returning 1
        )
        select count(*)::text as count from deleted
      `;
      draftsDeleted = Number(r2[0]?.count ?? 0);
    } catch (err) {
      // survey_drafts may not exist on legacy databases - the responses
      // wipe is the load-bearing half; log and continue.
      console.warn('[survey-stats] drafts purge failed (continuing):', err instanceof Error ? err.message : err);
    }
    return {
      responsesDeleted: Number(r1[0]?.count ?? 0),
      draftsDeleted,
    };
  },

  async build(opts: BuildOpts = {}): Promise<DashboardStats> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');

    const from = opts.from ?? null;
    const to   = opts.to   ?? null;

    // Dynamic WHERE built via embedded sql fragments. Postgres library v3
    // composes fragments into a single parameterised query - no string
    // concatenation, no injection risk.
    const fromClause = from ? sql`submitted_at >= ${from}::date`                        : sql`true`;
    const toClause   = to   ? sql`submitted_at < (${to}::date + interval '1 day')`      : sql`true`;

    const rows = await sql<Row[]>`
      select
        firm_size, role, years, bar_council,
        language, forum, practice, clients,
        research, drafting, storage, case_mgmt, case_mgmt_spec, efile,
        pain_open, rankings, hurdle, admin_hours,
        ai_usage, ai_tools, stop_reason, ai_wants, ai_wish,
        firm_departments,
        spend, will_pay, pricing_model, switching,
        concern, data_location, recommended,
        interview, beta, pilot, founder_call,
        submitted_at
      from survey_responses
      where ${fromClause} and ${toClause}
      order by submitted_at desc
    `;

    // survey_drafts is an analytics-only secondary table; if its migration
    // hasn't run on this DB the dashboard should still render. Swallow the
    // table-missing case so the responses pane below remains usable. Drafts
    // are window-independent (no per-row date column matches `submitted_at`
    // semantically), so they're not filtered here.
    let draftsTotal     = 0;
    let draftsAbandoned = 0;
    try {
      const draftSummary = await sql<{ total: string; abandoned: string }[]>`
        select
          count(*)::text                                            as total,
          count(*) filter (where completed_at is null)::text        as abandoned
        from survey_drafts
      `;
      draftsTotal     = Number(draftSummary[0]?.total ?? 0);
      draftsAbandoned = Number(draftSummary[0]?.abandoned ?? 0);
    } catch (err) {
      console.warn('[survey-stats] drafts summary failed (continuing):', err instanceof Error ? err.message : err);
    }

    // ---- Single-value aggregators -------------------------------------------
    const cohort   = new Map<string, number>();
    const role     = new Map<string, number>();
    const years    = new Map<string, number>();
    const barCnl   = new Map<string, number>();
    const cmgmt    = new Map<string, number>();
    const adminH   = new Map<string, number>();
    const aiUsage  = new Map<string, number>();
    const dataLoc  = new Map<string, number>();
    const recomm   = new Map<string, number>();

    // ---- Multi-select aggregators -------------------------------------------
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

    // Top-3 rankings: weighted 3 for 1st, 2 for 2nd, 1 for 3rd.
    const rankingsWeighted = new Map<string, number>();

    // Cohort-scoped: spend, willPay.
    const spendByCohort   = new Map<string, Map<string, number>>();
    const willPayByCohort = new Map<string, Map<string, number>>();
    const ensureInner = (m: Map<string, Map<string, number>>, k: string) => {
      let inner = m.get(k);
      if (!inner) { inner = new Map(); m.set(k, inner); }
      return inner;
    };

    // Follow-up opt-ins.
    let interviewYes = 0;
    let betaYes      = 0;
    let pilotYes     = 0;
    let pilotMaybe   = 0;
    let founderYes   = 0;

    // Timeseries window. Default is the trailing 30 days; if a from/to range
    // is given that exceeds 30 days, the timeseries expands to cover it so
    // the line/bar charts stay aligned with the rest of the dashboard.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const tsEnd = to ? new Date(`${to}T00:00:00Z`) : today;
    const fallbackStart = new Date(tsEnd.getTime() - 29 * 86_400_000);
    const tsStart = from ? new Date(`${from}T00:00:00Z`) : fallbackStart;
    // Cap timeseries length at 365 points so a degenerate filter (e.g.
    // from=2000-01-01) doesn't allocate millions of buckets.
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
    const last30Start = new Date(today.getTime() - 29 * 86_400_000);
    let last30Days = 0;

    const nonPii: NonPiiResponse[] = [];

    for (const r of rows) {
      tally(cohort,  r.firm_size);
      tally(role,    r.role);
      tally(years,   r.years);
      tally(barCnl,  r.bar_council);
      tally(cmgmt,   r.case_mgmt);
      tally(adminH,  r.admin_hours);
      tally(aiUsage, r.ai_usage);
      tally(dataLoc, r.data_location);
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
      tallyArray(aiTools,   r.ai_tools);
      tallyArray(stopR,     r.stop_reason);
      tallyArray(pricingM,  r.pricing_model);
      tallyArray(switching, r.switching);
      tallyArray(concern,   r.concern);

      if (r.rankings) {
        for (let i = 0; i < r.rankings.length && i < 3; i++) {
          const w = 3 - i; // 1st=3, 2nd=2, 3rd=1
          const slug = r.rankings[i]!;
          rankingsWeighted.set(slug, (rankingsWeighted.get(slug) ?? 0) + w);
        }
      }

      const spendInner   = ensureInner(spendByCohort,   r.firm_size);
      const willPayInner = ensureInner(willPayByCohort, r.firm_size);
      spendInner.set(r.spend, (spendInner.get(r.spend) ?? 0) + 1);
      willPayInner.set(r.will_pay, (willPayInner.get(r.will_pay) ?? 0) + 1);

      if (r.interview === 'yes')    interviewYes++;
      if (r.beta === 'yes')         betaYes++;
      if (r.pilot === 'yes')        pilotYes++;
      if (r.pilot === 'maybe')      pilotMaybe++;
      if (r.founder_call === 'yes') founderYes++;

      const submittedDate = new Date(r.submitted_at);
      const subDay = isoDay(submittedDate);
      const idx = dayIdx.get(subDay);
      if (idx !== undefined) {
        days[idx]!.count += 1;
      }
      if (submittedDate >= last30Start && submittedDate < new Date(today.getTime() + 86_400_000)) {
        last30Days += 1;
      }

      nonPii.push({
        firmSize:        r.firm_size,
        role:            r.role,
        years:           r.years,
        barCouncil:      r.bar_council,
        language:        r.language     ?? [],
        forum:           r.forum        ?? [],
        practice:        r.practice     ?? [],
        clients:         r.clients      ?? [],
        research:        r.research     ?? [],
        drafting:        r.drafting     ?? [],
        storage:         r.storage      ?? [],
        caseMgmt:        r.case_mgmt,
        caseMgmtSpec:    r.case_mgmt_spec,
        efile:           r.efile        ?? [],
        painOpen:        r.pain_open,
        rankings:        r.rankings     ?? [],
        hurdle:          r.hurdle       ?? [],
        adminHours:      r.admin_hours,
        aiUsage:         r.ai_usage,
        aiTools:         r.ai_tools     ?? [],
        stopReason:      r.stop_reason  ?? [],
        aiWants:         r.ai_wants,
        aiWish:          r.ai_wish,
        firmDepartments: r.firm_departments,
        spend:           r.spend,
        willPay:         r.will_pay,
        pricingModel:    r.pricing_model ?? [],
        switching:       r.switching    ?? [],
        concern:         r.concern      ?? [],
        dataLocation:    r.data_location,
        recommended:     r.recommended,
        interview:       r.interview,
        beta:            r.beta,
        pilot:           r.pilot,
        founderCall:     r.founder_call,
        submittedAt:     submittedDate.toISOString(),
      });
    }

    const recentActivity: RecentActivityRow[] = nonPii.slice(0, 20).map((r) => ({
      submittedAt: r.submittedAt,
      cohort:      r.firmSize,
      role:        r.role,
    }));

    const total = rows.length;
    // Completion rate: completed responses over all sessions that left a trace.
    // (drafts include both abandoned and completed, but `survey_drafts`
    // is the broader funnel; responses-not-via-draft can exist if the
    // server-side draft POST failed but submit succeeded - rare.)
    const sessions = total + draftsAbandoned;
    const completionRate = sessions > 0 ? total / sessions : 0;

    return {
      generatedAt: new Date().toISOString(),
      filters: { from, to },
      responses: {
        total,
        draftsTotal,
        draftsAbandoned,
        completionRate,
        last30Days,
      },
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
      timeseries:     days,
      rows:           nonPii,
      recentActivity,
    };
  },

  /** Paginated list of respondents with PII for the operator-only
   *  Respondents table. The CSV export already returns the same data
   *  unpaginated; this endpoint exists so the dashboard UI can render
   *  rows without downloading the whole file. */
  async listRespondents(opts: { limit: number; offset: number }): Promise<{
    total: number;
    limit: number;
    offset: number;
    rows: Array<{
      id: string;
      submittedAt: string;
      name: string;
      email: string;
      phone: string;
      city: string;
      barCouncil: string;
      role: string;
      years: string;
      firmSize: string;
      ipAddress: string | null;
      userAgent: string | null;
    }>;
  }> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');

    const totalRows = await sql<{ total: string }[]>`
      select count(*)::text as total from survey_responses
    `;
    const total = Number(totalRows[0]?.total ?? 0);

    const raw = await sql<Array<{
      id: string;
      submitted_at: Date;
      name: string;
      email: string;
      phone: string;
      city: string;
      bar_council: string;
      role: string;
      years: string;
      firm_size: string;
      ip_address: string | null;
      user_agent: string | null;
    }>>`
      select
        id, submitted_at,
        name, email, phone, city, bar_council,
        role, years, firm_size,
        host(ip_address) as ip_address, user_agent
      from survey_responses
      order by submitted_at desc
      limit ${opts.limit}
      offset ${opts.offset}
    `;

    return {
      total,
      limit: opts.limit,
      offset: opts.offset,
      rows: raw.map((r) => ({
        id: r.id,
        submittedAt: r.submitted_at instanceof Date ? r.submitted_at.toISOString() : String(r.submitted_at),
        name: r.name,
        email: r.email,
        phone: r.phone,
        city: r.city,
        barCouncil: r.bar_council,
        role: r.role,
        years: r.years,
        firmSize: r.firm_size,
        ipAddress: r.ip_address,
        userAgent: r.user_agent,
      })),
    };
  },

  async exportCsv(): Promise<string> {
    const sql = db();
    if (!sql) throw new Error('Database not configured');
    const rows = await sql<Record<string, unknown>[]>`
      select
        id, submitted_at, host(ip_address) as ip_address, user_agent,
        name, email, phone, city, bar_council,
        role, years, firm_size,
        firm_departments, support_staff, procurement, decision, decision_solo,
        language, forum, practice, clients,
        research, drafting, storage, case_mgmt, case_mgmt_spec, efile,
        pain_open, rankings, hurdle, admin_hours,
        ai_usage, ai_tools, stop_reason, ai_wants, ai_wish,
        spend, will_pay, pricing_model, switching,
        concern, data_location, recommended,
        interview, beta, pilot, founder_call,
        other_texts, idempotency_key
      from survey_responses
      order by submitted_at desc
    `;
    return toCsv(rows);
  },
};

// RFC 4180 escape: quote fields containing commas/quotes/newlines, double
// internal quotes. Objects (jsonb arrays, other_texts) are JSON-stringified
// so each cell stays one column; Date is ISO-stringified.
function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString();
  else if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  if (/[",\n\r]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}
