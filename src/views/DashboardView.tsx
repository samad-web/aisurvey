import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Sankey,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiClient } from '@/lib/api';
import {
  ADMIN_HOURS_ORDER,
  AI_USAGE_ORDER,
  COHORT_ORDER,
  RECOMMENDED_ORDER,
  SPEND_ORDER_BY_COHORT,
  WILL_PAY_ORDER_BY_COHORT,
  YEARS_ORDER,
  cohortLabel,
  labelFor,
} from '@/lib/survey-labels';
import type { Cohort } from '@/lib/survey-questions';
import {
  FIELD_META,
  aggregate,
  applyFilters,
  computeOpportunities,
  computePair,
  computeSankey,
  type FilterMap,
  type NonPiiResponse,
  type Opportunity,
  type PairMatrix,
  type RecomputedAggregates,
  type SankeyData,
} from '@/lib/dashboard-aggregate';
import { COHORT_LABELS } from '@/lib/survey-questions';
import { DateRangePicker, type DateRangeValue } from '@/components/dashboard/DateRangePicker';

// =============================================================================
// DashboardView - operator + role-segmented aggregate view of survey responses.
//
// The page is built around three orthogonal axes of state, all encoded in the
// URL so reloads reproduce the exact view:
//
//   ?view=operator|ceo|cfo|cto|investor   role tab
//   ?category=all|audience|practice|...   per-tab category filter
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD        date range (applied at SQL level)
//   ?cohort=solo&aiUsage=weekly&...       cross-filter chips
//
// Cross-filter chips re-derive every chart's buckets client-side from the
// non-PII `rows` array shipped in the payload (see dashboard-aggregate.ts).
// The recompute is O(N) - well under the 100ms budget for thousands of rows.
// =============================================================================

const STORAGE_KEY = 'sirah-dashboard-key-v1';
// Pre-rebrand key. The useState initialiser below copies it to STORAGE_KEY
// on first load so an already-authed operator isn't kicked back to the
// passcode screen after the rename.
const LEGACY_STORAGE_KEY = 'lexdraft-dashboard-key-v1';

// ---- API types (mirrors server/src/services/survey-stats.service.ts) -------
interface BucketStat { value: string; count: number }
interface CohortBucketStat { cohort: Cohort; value: string; count: number }
interface TimeseriesPoint { date: string; count: number }
interface RecentActivityRow { submittedAt: string; cohort: Cohort; role: string }
interface DashboardStats {
  generatedAt: string;
  filters: { from: string | null; to: string | null };
  responses: {
    total: number;
    draftsTotal: number;
    draftsAbandoned: number;
    completionRate: number;
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
  rows: NonPiiResponse[];
  recentActivity: RecentActivityRow[];
}

// =============================================================================
// Role + category vocab
// =============================================================================

type Role = 'operator' | 'ceo' | 'cfo' | 'cto' | 'investor';
const ROLES: { value: Role; label: string }[] = [
  { value: 'operator', label: 'Operator' },
  { value: 'ceo',      label: 'CEO' },
  { value: 'cfo',      label: 'CFO' },
  { value: 'cto',      label: 'CTO' },
  { value: 'investor', label: 'Investor' },
];

type Category = 'all' | 'audience' | 'practice' | 'tools' | 'pricing' | 'concerns' | 'funnel';
const CATEGORIES: { value: Category; label: string }[] = [
  { value: 'all',      label: 'All' },
  { value: 'audience', label: 'Audience' },
  { value: 'practice', label: 'Practice' },
  { value: 'tools',    label: 'Tools & AI' },
  { value: 'pricing',  label: 'Pricing' },
  { value: 'concerns', label: 'Concerns' },
  { value: 'funnel',   label: 'Funnel' },
];

// =============================================================================
// Top-level component
// =============================================================================

export function DashboardView() {
  // `?signout=1` is an escape hatch for users stuck on a stale cached key
  // (e.g. the server's DASHBOARD_KEY rotated). Clear the cache before
  // initialising state so the gate appears on first paint.
  if (typeof window !== 'undefined') {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('signout') === '1') {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      sp.delete('signout');
      const search = sp.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}`);
    }
  }

  const [key, setKey] = useState<string | null>(() => {
    try {
      const current = window.localStorage.getItem(STORAGE_KEY);
      if (current) return current;
      const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        window.localStorage.setItem(STORAGE_KEY, legacy);
        window.localStorage.removeItem(LEGACY_STORAGE_KEY);
        return legacy;
      }
      return null;
    } catch { return null; }
  });

  const handleAuth = (entered: string) => {
    try { window.localStorage.setItem(STORAGE_KEY, entered); } catch { /* ignore */ }
    setKey(entered);
  };

  const handleSignOut = () => {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setKey(null);
  };

  if (!key) return <PasscodeGate onUnlock={handleAuth} />;
  return <DashboardContent dashboardKey={key} onSignOut={handleSignOut} />;
}

// =============================================================================
// Passcode entry screen
// =============================================================================

function PasscodeGate({ onUnlock }: { onUnlock: (key: string) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) {
      setError('Please enter a passcode.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await apiClient.get('/api/dashboard/stats', {
        headers: { 'x-dashboard-key': value.trim() },
        validateStatus: () => true,
      });
      if (r.status === 401) { setError('Incorrect passcode.'); setBusy(false); return; }
      if (r.status >= 400)  { setError(`Server returned ${r.status}.`); setBusy(false); return; }
      onUnlock(value.trim());
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  };

  return (
    <div style={pageShellStyle}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <div className="card" style={{ padding: 32 }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>SirahDigital — operator</div>
          <h1 className="heading-xl" style={{ marginBottom: 8 }}>Dashboard</h1>
          <p className="body-md muted" style={{ marginBottom: 20 }}>
            Aggregated view of the Sirah Digital practitioner study. No personal data is
            shown — counts and distributions only.
          </p>
          <form onSubmit={submit}>
            <label className="label" htmlFor="dashboard-key">Passcode</label>
            <input
              id="dashboard-key"
              type="password"
              className="input"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Enter the operator passcode"
            />
            {error && (
              <div role="alert" style={errorBanner}>{error}</div>
            )}
            <button
              type="submit"
              className="btn btn-primary btn-lg btn-block"
              style={{ marginTop: 16 }}
              disabled={busy}
            >
              {busy ? 'Verifying…' : 'Unlock dashboard'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Dashboard content - fetch orchestrator + URL state
// =============================================================================

function DashboardContent({ dashboardKey, onSignOut }: {
  dashboardKey: string;
  onSignOut: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();

  // ---- URL-derived state -----
  const view: Role = useMemo(() => {
    const v = searchParams.get('view');
    return ROLES.some((r) => r.value === v) ? (v as Role) : 'operator';
  }, [searchParams]);

  const category: Category = useMemo(() => {
    const v = searchParams.get('category');
    return CATEGORIES.some((c) => c.value === v) ? (v as Category) : 'all';
  }, [searchParams]);

  const range: DateRangeValue = useMemo(() => ({
    from: searchParams.get('from'),
    to:   searchParams.get('to'),
  }), [searchParams]);

  // Cross-filter chips - any URL key in FIELD_META becomes a filter.
  const filters: FilterMap = useMemo(() => {
    const out: FilterMap = {};
    searchParams.forEach((v, k) => {
      if (k in FIELD_META && v) out[k] = v;
    });
    return out;
  }, [searchParams]);

  const setUrl = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setSearchParams(next, { replace: false });
  };

  // ---- Fetch state -----
  const [raw, setRaw] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);

  const load = async () => {
    try {
      const params: Record<string, string> = {};
      if (range.from) params.from = range.from;
      if (range.to)   params.to   = range.to;
      const r = await apiClient.get<DashboardStats>('/api/dashboard/stats', {
        headers: { 'x-dashboard-key': dashboardKey },
        params,
        validateStatus: () => true,
      });
      if (r.status === 401) { onSignOut(); return; }
      if (r.status >= 400)  { setError(`Server returned ${r.status}.`); return; }
      setRaw(r.data);
      setError(null);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
      setReloading(false);
    }
  };

  // Re-fetch when date range or auth changes. Cross-filter chips do NOT
  // refetch - they re-derive aggregates client-side from the row payload.
  useEffect(() => {
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardKey, range.from, range.to]);

  // ---- Filtered + recomputed aggregates -----
  const effective: (RecomputedAggregates & { filteredTotal: number; filteredRows: NonPiiResponse[] }) | null = useMemo(() => {
    if (!raw) return null;
    const hasFilter = Object.keys(filters).length > 0;
    const filteredRows = hasFilter ? applyFilters(raw.rows, filters) : raw.rows;
    if (!hasFilter) {
      // Use server-side aggregates as-is. Cheap path.
      return {
        cohort: raw.cohort,
        role: raw.role,
        years: raw.years,
        barCouncil: raw.barCouncil,
        language: raw.language,
        forum: raw.forum,
        practice: raw.practice,
        clients: raw.clients,
        research: raw.research,
        drafting: raw.drafting,
        storage: raw.storage,
        caseMgmt: raw.caseMgmt,
        efile: raw.efile,
        rankingsWeighted: raw.rankingsWeighted,
        hurdle: raw.hurdle,
        adminHours: raw.adminHours,
        aiUsage: raw.aiUsage,
        aiTools: raw.aiTools,
        stopReason: raw.stopReason,
        spendByCohort: raw.spendByCohort,
        willPayByCohort: raw.willPayByCohort,
        pricingModel: raw.pricingModel,
        switching: raw.switching,
        concern: raw.concern,
        dataLocation: raw.dataLocation,
        recommended: raw.recommended,
        followUps: raw.followUps,
        timeseries: raw.timeseries,
        total: raw.responses.total,
        filteredTotal: raw.responses.total,
        filteredRows,
      };
    }
    // Hot path: re-aggregate over the filtered subset.
    const agg = aggregate(filteredRows, {
      from: range.from ?? undefined,
      to:   range.to   ?? undefined,
    });
    return { ...agg, filteredTotal: filteredRows.length, filteredRows };
  }, [raw, filters, range]);

  if (loading && !raw) {
    return (
      <div style={pageShellStyle}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Loading dashboard…</div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onSignOut}
            style={{ fontSize: 12 }}
          >
            Sign in with a different passcode
          </button>
        </div>
      </div>
    );
  }
  if (error || !raw || !effective) {
    return (
      <div style={pageShellStyle}>
        <div style={{ width: '100%', maxWidth: 480 }}>
          <div className="card" style={{ padding: 24 }}>
            <h2 className="heading-md" style={{ marginBottom: 8 }}>Couldn&apos;t load dashboard</h2>
            <p className="body-sm muted" style={{ marginBottom: 16 }}>{error}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" type="button" onClick={() => { setReloading(true); void load(); }}>
                {reloading ? 'Retrying…' : 'Retry'}
              </button>
              <button className="btn" type="button" onClick={onSignOut}>Sign out</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- Filter handlers shared by every chart -----
  const onChartFilter = (key: string, slug: string) => {
    if (!(key in FIELD_META)) return;
    // Toggle off if same value clicked twice.
    if (filters[key] === slug) {
      setUrl({ [key]: null });
    } else {
      setUrl({ [key]: slug });
    }
  };

  const clearAllFilters = () => {
    const patch: Record<string, null> = {};
    for (const k of Object.keys(filters)) patch[k] = null;
    setUrl(patch);
  };

  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      <header
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-base)',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div style={{
          maxWidth: 1440,
          margin: '0 auto',
          padding: '20px clamp(16px, 4vw, 40px) 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>SirahDigital — operator</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <h1 className="heading-lg" style={{ marginBottom: 0 }}>Practitioner study dashboard</h1>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {new Date(raw.generatedAt).toLocaleString()}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <DateRangePicker
              value={range}
              onChange={(v) => setUrl({ from: v.from, to: v.to })}
            />
            <button className="btn btn-sm" type="button" onClick={() => { setReloading(true); void load(); }} disabled={reloading}>
              {reloading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="btn btn-sm" type="button" onClick={onSignOut}>Sign out</button>
          </div>
        </div>

        {/* Role tabs */}
        <div style={{
          maxWidth: 1440,
          margin: '0 auto',
          padding: '14px clamp(16px, 4vw, 40px) 12px',
          display: 'flex',
          gap: 14,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}>
          <PillNav
            items={ROLES}
            active={view}
            onChange={(v) => setUrl({ view: v === 'operator' ? null : v, category: null })}
          />
          <PillNav
            items={CATEGORIES}
            active={category}
            onChange={(v) => setUrl({ category: v === 'all' ? null : v })}
          />
        </div>
      </header>

      <main style={{
        maxWidth: 1440,
        margin: '0 auto',
        padding: 'clamp(20px, 3vw, 32px) clamp(16px, 4vw, 40px) 80px',
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
      }}>
        {/* Active filter chips */}
        <FilterChips
          filters={filters}
          onClear={(k) => setUrl({ [k]: null })}
          onClearAll={clearAllFilters}
          filteredTotal={effective.filteredTotal}
          rawTotal={raw.responses.total}
        />

        {raw.responses.total === 0 && <EmptyState />}

        {/* KPI row reflects the filtered set when chips are active. */}
        <KpiRow stats={raw} effective={effective} />

        {/* Role + category dispatch */}
        <RoleLayout
          view={view}
          category={category}
          stats={raw}
          effective={effective}
          filters={filters}
          onFilter={onChartFilter}
          dashboardKey={dashboardKey}
          onReload={() => { setReloading(true); void load(); }}
          onSignOut={onSignOut}
        />

        <footer style={{
          marginTop: 16,
          paddingTop: 24,
          borderTop: '1px solid var(--border-subtle)',
          color: 'var(--text-tertiary)',
          fontSize: 12,
        }}>
          {raw.responses.total} response{raw.responses.total === 1 ? '' : 's'} ·
          {' '}{raw.responses.draftsAbandoned} abandoned draft{raw.responses.draftsAbandoned === 1 ? '' : 's'} ·
          {' '}Generated {new Date(raw.generatedAt).toLocaleString()}
          {raw.filters.from && <> · From {raw.filters.from}</>}
          {raw.filters.to   && <> · To {raw.filters.to}</>}
        </footer>
      </main>
    </div>
  );
}

// =============================================================================
// Pill nav - reuses .pill-nav from globals.css.
// =============================================================================

function PillNav<T extends string>({ items, active, onChange }: {
  items: { value: T; label: string }[];
  active: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="pill-nav">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          className={active === it.value ? 'active' : ''}
          onClick={() => onChange(it.value)}
          style={{
            background: active === it.value ? 'var(--text-primary)' : 'transparent',
            color: active === it.value ? 'var(--bg-base)' : 'var(--text-secondary)',
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

// =============================================================================
// Filter chips
// =============================================================================

function FilterChips({ filters, onClear, onClearAll, filteredTotal, rawTotal }: {
  filters: FilterMap;
  onClear: (key: string) => void;
  onClearAll: () => void;
  filteredTotal: number;
  rawTotal: number;
}) {
  const entries = Object.entries(filters);
  if (entries.length === 0) return null;
  return (
    <div className="card" style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '12px 16px',
      flexWrap: 'wrap',
    }}>
      <span className="eyebrow" style={{ marginRight: 4 }}>Filters</span>
      {entries.map(([key, slug]) => (
        <button
          key={key}
          type="button"
          className="chip active"
          onClick={() => onClear(key)}
          title={`Remove filter ${key}`}
        >
          <span style={{ color: 'var(--text-tertiary)', marginRight: 6, fontSize: 11 }}>{prettyFieldName(key)}:</span>
          <span>{labelFor(key === 'cohort' ? 'firmSize' : key, slug)}</span>
          <span aria-hidden style={{ marginLeft: 8, opacity: 0.6 }}>×</span>
        </button>
      ))}
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={onClearAll}
        style={{ marginLeft: 'auto', fontSize: 12 }}
      >
        × Clear all
      </button>
      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
        {filteredTotal} of {rawTotal} responses
      </span>
    </div>
  );
}

function prettyFieldName(k: string): string {
  if (k === 'cohort') return 'Cohort';
  return k
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

// =============================================================================
// KPI row
// =============================================================================

function KpiRow({ stats, effective }: {
  stats: DashboardStats;
  effective: RecomputedAggregates & { filteredTotal: number; filteredRows: NonPiiResponse[] };
}) {
  const r = stats.responses;
  const total = effective.filteredTotal;
  const completion = (r.completionRate * 100).toFixed(0);
  const topCohort = effective.cohort[0];
  const topCohortLabel = topCohort ? cohortLabel(topCohort.value as Cohort) : '—';
  const topCohortShare = topCohort && total > 0
    ? `${Math.round((topCohort.count / total) * 100)}%`
    : '—';

  const aiAdoption = (() => {
    const t = effective.aiUsage.reduce((acc, b) => acc + b.count, 0);
    if (t === 0) return { share: '—', detail: 'No responses' };
    const active = effective.aiUsage
      .filter((b) => b.value === 'daily' || b.value === 'weekly' || b.value === 'occasional')
      .reduce((acc, b) => acc + b.count, 0);
    return {
      share: `${Math.round((active / t) * 100)}%`,
      detail: `${active} of ${t} use AI today`,
    };
  })();

  return (
    <div className="stat-row">
      <Kpi label="Responses" value={total.toLocaleString()} hint={`${r.last30Days} in last 30 days`} />
      <Kpi label="Completion rate" value={`${completion}%`} hint={`${r.draftsAbandoned} drafts abandoned`} />
      <Kpi label="Largest cohort" value={topCohortLabel} hint={`${topCohortShare} share`} />
      <Kpi label="AI active users" value={aiAdoption.share} hint={aiAdoption.detail} />
      <Kpi label="Beta opt-ins" value={effective.followUps.betaYes.toString()} hint={`${effective.followUps.interviewYes} agreed to interview`} />
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 28,
        fontWeight: 600,
        letterSpacing: '-0.015em',
        lineHeight: 1.1,
        color: 'var(--text-primary)',
      }}>{value}</div>
      {hint && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-tertiary)' }}>{hint}</div>
      )}
    </div>
  );
}

// =============================================================================
// Role + category dispatch
// =============================================================================

interface LayoutProps {
  stats: DashboardStats;
  effective: RecomputedAggregates & { filteredTotal: number; filteredRows: NonPiiResponse[] };
  filters: FilterMap;
  category: Category;
  onFilter: (key: string, slug: string) => void;
}

function RoleLayout(props: LayoutProps & {
  view: Role;
  dashboardKey: string;
  onReload: () => void;
  onSignOut: () => void;
}) {
  switch (props.view) {
    case 'operator': return <OperatorLayout {...props} />;
    case 'ceo':      return <CEOLayout {...props} />;
    case 'cfo':      return <CFOLayout {...props} />;
    case 'cto':      return <CTOLayout {...props} />;
    case 'investor': return <InvestorLayout {...props} />;
  }
}

// ChartCard accepts a category prop so the category pill row can hide
// non-matching cards within whichever layout is active.
function ChartCard({ title, subtitle, category, activeCategory, span = 1, children }: {
  title: string;
  subtitle?: string;
  category: Category;
  activeCategory: Category;
  span?: number;
  children: ReactNode;
}) {
  if (activeCategory !== 'all' && activeCategory !== category) return null;
  return (
    <div className="card" style={{ gridColumn: span > 1 ? `span ${span}` : undefined }}>
      <header style={{ marginBottom: 12 }}>
        <h3 className="heading-sm" style={{ marginBottom: 2 }}>{title}</h3>
        {subtitle && (
          <p className="body-sm" style={{ color: 'var(--text-tertiary)' }}>{subtitle}</p>
        )}
      </header>
      {children}
    </div>
  );
}

function Section({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return (
    <section>
      <header style={{ marginBottom: 16 }}>
        {eyebrow && <div className="eyebrow" style={{ marginBottom: 4 }}>{eyebrow}</div>}
        <h2 className="heading-md">{title}</h2>
      </header>
      {children}
    </section>
  );
}

function EmptyCategory() {
  return (
    <div className="card-cream" style={{ padding: 24, textAlign: 'center' }}>
      <p className="body-sm muted">No charts in this category for this view.</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card-cream" style={{ padding: 24 }}>
      <h2 className="heading-md" style={{ marginBottom: 6 }}>No responses yet</h2>
      <p className="body-sm muted">
        Once respondents start submitting, the charts below will populate. Until then,
        the dashboard renders empty containers so the layout is still inspectable.
      </p>
    </div>
  );
}

// =============================================================================
// Operator layout - the original 9 sections, every chart click-filters.
// =============================================================================

function OperatorLayout({ stats, effective, filters, category, onFilter, dashboardKey, onReload, onSignOut }: LayoutProps & {
  dashboardKey: string;
  onReload: () => void;
  onSignOut: () => void;
}) {
  const total = effective.filteredTotal;
  const cardsRendered = (children: ReactNode[]) =>
    children.some((c) => c !== null) ? children : <EmptyCategory />;

  // ---- Derived insight aggregates (recompute when filter changes) ----
  const opportunities = useMemo(
    () => computeOpportunities(effective.filteredRows, WILL_PAY_ORDER_BY_COHORT),
    [effective.filteredRows],
  );
  const sankey = useMemo(
    () => computeSankey(effective.filteredRows, WILL_PAY_ORDER_BY_COHORT, COHORT_LABELS),
    [effective.filteredRows],
  );
  const pairs = useMemo(() => ({
    firmSizeAiUsage: computePair(effective.filteredRows, 'firmSize', 'aiUsage', {
      rowOrder: COHORT_ORDER,
      colOrder: AI_USAGE_ORDER,
    }),
    firmSizeWillPay: computePair(effective.filteredRows, 'firmSize', 'willPay', {
      rowOrder: COHORT_ORDER,
      topNCols: 8,
    }),
    practiceAiTools: computePair(effective.filteredRows, 'practice', 'aiTools', {
      topNRows: 8,
      topNCols: 8,
    }),
    yearsSwitching: computePair(effective.filteredRows, 'years', 'switching', {
      rowOrder: YEARS_ORDER,
    }),
    concernCohort: computePair(effective.filteredRows, 'concern', 'firmSize', {
      colOrder: COHORT_ORDER,
      topNRows: 8,
    }),
  }), [effective.filteredRows]);

  return (
    <>
      {/* INSIGHTS - decision-useful derived views, top of the page */}
      <Section title="Insights" eyebrow="Decision support">
        <div style={chartGrid({ minCol: 320 })}>
          <ChartCard
            title="Top opportunities"
            subtitle="Pain weight × willingness-to-pay → build-priority score"
            category="practice"
            activeCategory={category}
            span={2}
          >
            <TopOpportunities opportunities={opportunities} />
          </ChartCard>
          <ChartCard
            title="Voice of the customer"
            subtitle="Verbatim answers from the open-text fields"
            category="practice"
            activeCategory={category}
            span={2}
          >
            <FreeTextPanel rows={effective.filteredRows} />
          </ChartCard>
          <ChartCard
            title="Cohort → AI usage → Willingness flow"
            subtitle="Where each cohort lands on AI adoption and price tier"
            category="pricing"
            activeCategory={category}
            span={2}
          >
            <CohortSankey data={sankey} />
          </ChartCard>
        </div>
      </Section>

      {/* CORRELATIONS - 5 pairwise heatmaps from the original spec */}
      <Section title="Correlations" eyebrow="Joint distributions">
        <div style={chartGrid({ minCol: 360 })}>
          <ChartCard title="Firm size × AI usage" subtitle="Adoption by cohort" category="tools" activeCategory={category}>
            <Heatmap
              pair={pairs.firmSizeAiUsage}
              rowLabelFn={(s) => cohortLabel(s as Cohort)}
              colLabelFn={(s) => labelFor('aiUsage', s)}
            />
          </ChartCard>
          <ChartCard title="Firm size × Willingness to pay" subtitle="Where the money is" category="pricing" activeCategory={category}>
            <Heatmap
              pair={pairs.firmSizeWillPay}
              rowLabelFn={(s) => cohortLabel(s as Cohort)}
              colLabelFn={(s) => labelFor('willPay', s)}
            />
          </ChartCard>
          <ChartCard title="Practice × AI tools" subtitle="Which practices use what" category="tools" activeCategory={category}>
            <Heatmap
              pair={pairs.practiceAiTools}
              rowLabelFn={(s) => labelFor('practice', s)}
              colLabelFn={(s) => labelFor('aiTools', s)}
            />
          </ChartCard>
          <ChartCard title="Years × Switching willingness" subtitle="Experience vs flexibility" category="pricing" activeCategory={category}>
            <Heatmap
              pair={pairs.yearsSwitching}
              rowLabelFn={(s) => labelFor('years', s)}
              colLabelFn={(s) => labelFor('switching', s)}
            />
          </ChartCard>
          <ChartCard title="Concerns × Cohort" subtitle="Who blocks on what" category="concerns" activeCategory={category}>
            <Heatmap
              pair={pairs.concernCohort}
              rowLabelFn={(s) => labelFor('concern', s)}
              colLabelFn={(s) => cohortLabel(s as Cohort)}
            />
          </ChartCard>
        </div>
      </Section>

      {/* FUNNEL */}
      <Section title="Funnel" eyebrow="Engagement">
        <div style={chartGrid({ minCol: 320 })}>
          {cardsRendered([
            <ChartCard key="ts" title="Submissions over time" subtitle="Daily completed responses" category="funnel" activeCategory={category}>
              <SubmissionsLine timeseries={effective.timeseries} />
            </ChartCard>,
            <ChartCard key="fu" title="Follow-up opt-ins" subtitle="Respondents who agreed to a follow-up of each kind" category="funnel" activeCategory={category}>
              <FollowUpBars followUps={effective.followUps} total={total} />
            </ChartCard>,
          ])}
        </div>
      </Section>

      {/* COHORT & PROFILE */}
      <Section title="Cohort & profile" eyebrow="Who answered">
        <div style={chartGrid({ minCol: 320 })}>
          {cardsRendered([
            <ChartCard key="co" title="Firm size cohort" subtitle="Click a slice to filter" category="audience" activeCategory={category}>
              <CohortDonut data={effective.cohort} total={total} selected={filters.cohort} onSelect={(v) => onFilter('cohort', v)} />
            </ChartCard>,
            <ChartCard key="yr" title="Years of practice" subtitle="Ordered low to high" category="audience" activeCategory={category}>
              <OrderedBars buckets={effective.years} order={YEARS_ORDER} field="years" height={220} selected={filters.years} onSelect={(v) => onFilter('years', v)} />
            </ChartCard>,
            <ChartCard key="ro" title="Role" subtitle="Top role categories" category="audience" activeCategory={category}>
              <HorizontalBars
                data={effective.role.map((b) => ({ value: b.value, label: labelFor('role', b.value), count: b.count }))}
                total={total}
                height={Math.max(220, effective.role.length * 28)}
                topN={10}
                selected={filters.role}
                onSelect={(v) => onFilter('role', v)}
              />
            </ChartCard>,
            <ChartCard key="bc" title="State Bar Council" subtitle="Geographic distribution" category="audience" activeCategory={category}>
              <HorizontalBars
                data={effective.barCouncil.map((b) => ({ value: b.value, label: labelFor('barCouncil', b.value), count: b.count }))}
                total={total}
                height={220}
                selected={filters.barCouncil}
                onSelect={(v) => onFilter('barCouncil', v)}
              />
            </ChartCard>,
          ])}
        </div>
      </Section>

      {/* PRACTICE PROFILE */}
      <Section title="Practice profile" eyebrow="Where & what they practise">
        <div style={chartGrid({ minCol: 320 })}>
          {cardsRendered([
            <ChartCard key="pr" title="Practice areas" subtitle="Pick up to 5 per response" category="practice" activeCategory={category}>
              <HorizontalBars
                data={effective.practice.map((b) => ({ value: b.value, label: labelFor('practice', b.value), count: b.count }))}
                total={total}
                height={Math.max(220, effective.practice.length * 26)}
                topN={12}
                selected={filters.practice}
                onSelect={(v) => onFilter('practice', v)}
              />
            </ChartCard>,
            <ChartCard key="fo" title="Courts & forums" subtitle="Where matters are heard" category="practice" activeCategory={category}>
              <HorizontalBars
                data={effective.forum.map((b) => ({ value: b.value, label: labelFor('forum', b.value), count: b.count }))}
                total={total}
                height={Math.max(220, effective.forum.length * 24)}
                topN={12}
                selected={filters.forum}
                onSelect={(v) => onFilter('forum', v)}
              />
            </ChartCard>,
            <ChartCard key="la" title="Languages of court work" subtitle="Multi-select per response" category="practice" activeCategory={category}>
              <HorizontalBars
                data={effective.language.map((b) => ({ value: b.value, label: labelFor('language', b.value), count: b.count }))}
                total={total}
                height={220}
                selected={filters.language}
                onSelect={(v) => onFilter('language', v)}
              />
            </ChartCard>,
            <ChartCard key="cl" title="Client mix" subtitle="Typical client categories" category="practice" activeCategory={category}>
              <HorizontalBars
                data={effective.clients.map((b) => ({ value: b.value, label: labelFor('clients', b.value), count: b.count }))}
                total={total}
                height={220}
                selected={filters.clients}
                onSelect={(v) => onFilter('clients', v)}
              />
            </ChartCard>,
          ])}
        </div>
      </Section>

      {/* TOOLS TODAY */}
      <Section title="Tools today" eyebrow="Current stack">
        <div style={chartGrid({ minCol: 320 })}>
          {cardsRendered([
            <ChartCard key="re" title="Research platforms" category="tools" activeCategory={category}>
              <HorizontalBars
                data={effective.research.map((b) => ({ value: b.value, label: labelFor('research', b.value), count: b.count }))}
                total={total}
                height={Math.max(240, effective.research.length * 22)}
                topN={12}
                selected={filters.research}
                onSelect={(v) => onFilter('research', v)}
              />
            </ChartCard>,
            <ChartCard key="dr" title="Primary drafting tools" category="tools" activeCategory={category}>
              <HorizontalBars
                data={effective.drafting.map((b) => ({ value: b.value, label: labelFor('drafting', b.value), count: b.count }))}
                total={total}
                height={220}
                selected={filters.drafting}
                onSelect={(v) => onFilter('drafting', v)}
              />
            </ChartCard>,
            <ChartCard key="st" title="Document storage" category="tools" activeCategory={category}>
              <HorizontalBars
                data={effective.storage.map((b) => ({ value: b.value, label: labelFor('storage', b.value), count: b.count }))}
                total={total}
                height={Math.max(220, effective.storage.length * 24)}
                topN={12}
                selected={filters.storage}
                onSelect={(v) => onFilter('storage', v)}
              />
            </ChartCard>,
            <ChartCard key="ef" title="E-filing systems" category="tools" activeCategory={category}>
              <HorizontalBars
                data={effective.efile.map((b) => ({ value: b.value, label: labelFor('efile', b.value), count: b.count }))}
                total={total}
                height={Math.max(220, effective.efile.length * 24)}
                topN={12}
                selected={filters.efile}
                onSelect={(v) => onFilter('efile', v)}
              />
            </ChartCard>,
          ])}
        </div>
      </Section>

      {/* TIME GOES */}
      <Section title="Where the time goes" eyebrow="Pain points">
        <div style={chartGrid({ minCol: 320 })}>
          {cardsRendered([
            <ChartCard key="rk" title="Top-3 time-consuming tasks" subtitle="Weighted: 3 for 1st, 2 for 2nd, 1 for 3rd" category="practice" activeCategory={category}>
              <HorizontalBars
                data={effective.rankingsWeighted.map((b) => ({ value: b.value, label: labelFor('rankings', b.value), count: b.count }))}
                total={undefined}
                height={Math.max(260, effective.rankingsWeighted.length * 26)}
                topN={12}
                accent
                selected={filters.rankings}
                onSelect={(v) => onFilter('rankings', v)}
              />
            </ChartCard>,
            <ChartCard key="hu" title="Biggest hurdles" category="practice" activeCategory={category}>
              <HorizontalBars
                data={effective.hurdle.map((b) => ({ value: b.value, label: labelFor('hurdle', b.value), count: b.count }))}
                total={total}
                height={Math.max(220, effective.hurdle.length * 26)}
                selected={filters.hurdle}
                onSelect={(v) => onFilter('hurdle', v)}
              />
            </ChartCard>,
            <ChartCard key="ah" title="Daily non-billable admin" subtitle="Self-reported hours per day" category="practice" activeCategory={category}>
              <OrderedBars buckets={effective.adminHours} order={ADMIN_HOURS_ORDER} field="adminHours" height={220} selected={filters.adminHours} onSelect={(v) => onFilter('adminHours', v)} />
            </ChartCard>,
          ])}
        </div>
      </Section>

      {/* AI EXPERIENCE */}
      <Section title="AI experience" eyebrow="History with AI">
        <div style={chartGrid({ minCol: 320 })}>
          {cardsRendered([
            <ChartCard key="au" title="Current AI usage" category="tools" activeCategory={category}>
              <OrderedBars buckets={effective.aiUsage} order={AI_USAGE_ORDER} field="aiUsage" height={220} rotateTicks selected={filters.aiUsage} onSelect={(v) => onFilter('aiUsage', v)} />
            </ChartCard>,
            <ChartCard key="at" title="AI tools used (last 6 months)" subtitle="Among respondents who use or tried AI" category="tools" activeCategory={category}>
              <HorizontalBars
                data={effective.aiTools.map((b) => ({ value: b.value, label: labelFor('aiTools', b.value), count: b.count }))}
                total={undefined}
                height={Math.max(240, effective.aiTools.length * 24)}
                topN={14}
                selected={filters.aiTools}
                onSelect={(v) => onFilter('aiTools', v)}
              />
            </ChartCard>,
            <ChartCard key="sr" title="Reasons for stopping or reducing AI" category="tools" activeCategory={category}>
              <HorizontalBars
                data={effective.stopReason.map((b) => ({ value: b.value, label: labelFor('stopReason', b.value), count: b.count }))}
                total={undefined}
                height={Math.max(220, effective.stopReason.length * 26)}
                selected={filters.stopReason}
                onSelect={(v) => onFilter('stopReason', v)}
              />
            </ChartCard>,
          ])}
        </div>
      </Section>

      {/* PRICING */}
      <Section title="Pricing & value" eyebrow="What they'd pay">
        <div style={chartGrid({ minCol: 320 })}>
          {cardsRendered([
            <ChartCard key="pm" title="Preferred pricing models" category="pricing" activeCategory={category}>
              <HorizontalBars
                data={effective.pricingModel.map((b) => ({ value: b.value, label: labelFor('pricingModel', b.value), count: b.count }))}
                total={total}
                height={220}
                selected={filters.pricingModel}
                onSelect={(v) => onFilter('pricingModel', v)}
              />
            </ChartCard>,
            <ChartCard key="sw" title="Switching willingness" category="pricing" activeCategory={category}>
              <HorizontalBars
                data={effective.switching.map((b) => ({ value: b.value, label: labelFor('switching', b.value), count: b.count }))}
                total={undefined}
                height={220}
                selected={filters.switching}
                onSelect={(v) => onFilter('switching', v)}
              />
            </ChartCard>,
            <ChartCard key="sp" title="Spend by cohort" subtitle="Annual research + drafting spend, cohort-relative buckets" category="pricing" activeCategory={category} span={2}>
              <CohortStackedBars data={effective.spendByCohort} orderFor={(c) => SPEND_ORDER_BY_COHORT[c]} labelFor={(slug) => labelFor('spend', slug)} />
            </ChartCard>,
            <ChartCard key="wp" title="Willingness to pay by cohort" subtitle="Per user, per month — assuming 10 hrs/week saved" category="pricing" activeCategory={category} span={2}>
              <CohortStackedBars data={effective.willPayByCohort} orderFor={(c) => WILL_PAY_ORDER_BY_COHORT[c]} labelFor={(slug) => labelFor('willPay', slug)} />
            </ChartCard>,
          ])}
        </div>
      </Section>

      {/* TRUST */}
      <Section title="Trust & concerns" eyebrow="Adoption blockers">
        <div style={chartGrid({ minCol: 320 })}>
          {cardsRendered([
            <ChartCard key="cn" title="Concerns about adoption" category="concerns" activeCategory={category}>
              <HorizontalBars
                data={effective.concern.map((b) => ({ value: b.value, label: labelFor('concern', b.value), count: b.count }))}
                total={total}
                height={Math.max(240, effective.concern.length * 26)}
                selected={filters.concern}
                onSelect={(v) => onFilter('concern', v)}
              />
            </ChartCard>,
            <ChartCard key="dl" title="Required data location" category="concerns" activeCategory={category}>
              <HorizontalBars
                data={effective.dataLocation.map((b) => ({ value: b.value, label: labelFor('dataLocation', b.value), count: b.count }))}
                total={total}
                height={220}
                selected={filters.dataLocation}
                onSelect={(v) => onFilter('dataLocation', v)}
              />
            </ChartCard>,
            <ChartCard key="rc" title="Likelihood to try on referral" category="concerns" activeCategory={category}>
              <OrderedBars buckets={effective.recommended} order={RECOMMENDED_ORDER} field="recommended" height={220} rotateTicks selected={filters.recommended} onSelect={(v) => onFilter('recommended', v)} />
            </ChartCard>,
            <ChartCard key="cr" title="Concerns radar" subtitle="Top concerns by share" category="concerns" activeCategory={category}>
              <ConcernRadar concerns={effective.concern} total={total} />
            </ChartCard>,
          ])}
        </div>
      </Section>

      {/* Danger zone - only renders on the Operator view, never on the role
          tabs intended for read-only stakeholders. The two-step typed
          confirmation is enforced both here and again server-side. */}
      <DangerZone
        rawTotal={stats.responses.total}
        draftsAbandoned={stats.responses.draftsAbandoned}
        dashboardKey={dashboardKey}
        onPurged={onReload}
        onSignOut={onSignOut}
      />
    </>
  );
}

// =============================================================================
// DangerZone - typed-confirmation wipe of survey_responses + survey_drafts.
// =============================================================================

function DangerZone({ rawTotal, draftsAbandoned, dashboardKey, onPurged, onSignOut }: {
  rawTotal: number;
  draftsAbandoned: number;
  dashboardKey: string;
  onPurged: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ responsesDeleted: number; draftsDeleted: number } | null>(null);

  const close = () => {
    setOpen(false);
    setConfirmText('');
    setError(null);
    setDone(null);
  };

  const submit = async () => {
    if (confirmText !== 'DELETE ALL') return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiClient.delete('/api/dashboard/data', {
        headers: { 'x-dashboard-key': dashboardKey },
        data: { confirm: 'DELETE ALL' },
        validateStatus: () => true,
      });
      if (r.status === 401) {
        setError('Passcode rejected. Sign in again.');
        setBusy(false);
        // Force user back to the login screen.
        setTimeout(() => onSignOut(), 800);
        return;
      }
      if (r.status >= 400) {
        setError(`Server returned ${r.status}. No data was deleted.`);
        setBusy(false);
        return;
      }
      const responsesDeleted = Number(r.data?.responsesDeleted ?? 0);
      const draftsDeleted    = Number(r.data?.draftsDeleted    ?? 0);
      setDone({ responsesDeleted, draftsDeleted });
      setBusy(false);
      // Refresh the dashboard so the operator sees an empty state. Delay
      // briefly so they can read the confirmation banner.
      setTimeout(() => { close(); onPurged(); }, 1500);
    } catch {
      setError('Could not reach the server. No data was deleted.');
      setBusy(false);
    }
  };

  return (
    <section style={{ marginTop: 16 }}>
      <div
        className="card"
        style={{
          borderColor: 'var(--danger)',
          padding: 20,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ minWidth: 240, flex: '1 1 360px' }}>
          <div className="eyebrow" style={{ color: 'var(--danger)', marginBottom: 4 }}>Danger zone</div>
          <h3 className="heading-sm" style={{ marginBottom: 4 }}>Delete all survey data</h3>
          <p className="body-sm" style={{ color: 'var(--text-secondary)' }}>
            Permanently removes {rawTotal} response{rawTotal === 1 ? '' : 's'} and
            {' '}{draftsAbandoned} abandoned draft{draftsAbandoned === 1 ? '' : 's'} from the database. This action
            cannot be undone.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={rawTotal === 0 && draftsAbandoned === 0}
          style={{
            border: '1px solid var(--danger)',
            background: 'transparent',
            color: 'var(--danger)',
            padding: '0 var(--space-7)',
            minHeight: 40,
            borderRadius: 'var(--radius-md)',
            fontWeight: 500,
            fontSize: 14,
            cursor: rawTotal === 0 && draftsAbandoned === 0 ? 'not-allowed' : 'pointer',
            opacity: rawTotal === 0 && draftsAbandoned === 0 ? 0.5 : 1,
            transition: 'background 120ms, color 120ms',
          }}
          onMouseEnter={(e) => {
            if (rawTotal > 0 || draftsAbandoned > 0) {
              e.currentTarget.style.background = 'var(--danger)';
              e.currentTarget.style.color = 'var(--bg-base)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--danger)';
          }}
        >
          Delete all data
        </button>
      </div>

      {open && (
        <PurgeConfirmModal
          rawTotal={rawTotal}
          draftsAbandoned={draftsAbandoned}
          confirmText={confirmText}
          onConfirmTextChange={setConfirmText}
          onCancel={close}
          onSubmit={submit}
          busy={busy}
          error={error}
          done={done}
        />
      )}
    </section>
  );
}

function PurgeConfirmModal({
  rawTotal, draftsAbandoned,
  confirmText, onConfirmTextChange,
  onCancel, onSubmit, busy, error, done,
}: {
  rawTotal: number;
  draftsAbandoned: number;
  confirmText: string;
  onConfirmTextChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
  done: { responsesDeleted: number; draftsDeleted: number } | null;
}) {
  const phraseOk = confirmText === 'DELETE ALL';
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="purge-title"
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,10,10,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card"
        style={{
          maxWidth: 480,
          width: '100%',
          padding: 24,
          borderColor: 'var(--danger)',
          animation: 'modal-body-in 180ms ease-out',
        }}
      >
        {done ? (
          <>
            <div className="eyebrow" style={{ color: 'var(--success)', marginBottom: 4 }}>Done</div>
            <h2 id="purge-title" className="heading-md" style={{ marginBottom: 8 }}>Data deleted</h2>
            <p className="body-sm" style={{ color: 'var(--text-secondary)' }}>
              Removed {done.responsesDeleted} response{done.responsesDeleted === 1 ? '' : 's'} and
              {' '}{done.draftsDeleted} draft{done.draftsDeleted === 1 ? '' : 's'}. Refreshing the dashboard…
            </p>
          </>
        ) : (
          <>
            <div className="eyebrow" style={{ color: 'var(--danger)', marginBottom: 4 }}>Irreversible</div>
            <h2 id="purge-title" className="heading-md" style={{ marginBottom: 8 }}>Delete all survey data</h2>
            <p className="body-sm" style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
              You&apos;re about to permanently remove <strong style={{ color: 'var(--text-primary)' }}>{rawTotal}</strong> response
              {rawTotal === 1 ? '' : 's'} and <strong style={{ color: 'var(--text-primary)' }}>{draftsAbandoned}</strong> abandoned draft
              {draftsAbandoned === 1 ? '' : 's'}. No backup is taken. Type
              {' '}<code style={{
                background: 'var(--bg-surface-2)',
                border: '1px solid var(--border-default)',
                padding: '1px 6px',
                borderRadius: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
              }}>DELETE ALL</code> to enable the button.
            </p>

            <label className="label" htmlFor="purge-confirm">Confirmation phrase</label>
            <input
              id="purge-confirm"
              type="text"
              className="input"
              autoComplete="off"
              autoFocus
              value={confirmText}
              onChange={(e) => onConfirmTextChange(e.target.value)}
              placeholder="DELETE ALL"
              disabled={busy}
              style={{ fontFamily: 'var(--font-mono)' }}
            />

            {error && (
              <div role="alert" style={{
                marginTop: 14,
                fontSize: 13,
                color: 'var(--danger)',
                background: 'var(--danger-bg)',
                border: '1px solid var(--danger)',
                borderRadius: 'var(--radius-md)',
                padding: '10px 12px',
              }}>{error}</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button type="button" className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={!phraseOk || busy}
                style={{
                  border: '1px solid var(--danger)',
                  background: phraseOk ? 'var(--danger)' : 'transparent',
                  color: phraseOk ? 'var(--bg-base)' : 'var(--danger)',
                  padding: '0 var(--space-7)',
                  minHeight: 40,
                  borderRadius: 'var(--radius-md)',
                  fontWeight: 500,
                  fontSize: 14,
                  cursor: phraseOk && !busy ? 'pointer' : 'not-allowed',
                  opacity: phraseOk && !busy ? 1 : 0.5,
                  transition: 'background 120ms, color 120ms',
                }}
              >
                {busy ? 'Deleting…' : 'Delete all data'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// CEO layout - strategy snapshot
// =============================================================================

function CEOLayout({ effective, filters, category, onFilter }: LayoutProps) {
  const total = effective.filteredTotal;
  const opportunities = useMemo(
    () => computeOpportunities(effective.filteredRows, WILL_PAY_ORDER_BY_COHORT),
    [effective.filteredRows],
  );
  const sankey = useMemo(
    () => computeSankey(effective.filteredRows, WILL_PAY_ORDER_BY_COHORT, COHORT_LABELS),
    [effective.filteredRows],
  );
  return (
    <>
      <CEOKpis effective={effective} />
      <Section title="Build priorities" eyebrow="CEO view">
        <div style={chartGrid({ minCol: 360 })}>
          <ChartCard
            title="Top opportunities"
            subtitle="Pain weight × willingness-to-pay → build-priority score"
            category="practice"
            activeCategory={category}
            span={2}
          >
            <TopOpportunities opportunities={opportunities} />
          </ChartCard>
          <ChartCard
            title="Cohort → AI usage → Willingness flow"
            subtitle="Where each cohort lands on AI adoption and price tier"
            category="pricing"
            activeCategory={category}
            span={2}
          >
            <CohortSankey data={sankey} />
          </ChartCard>
        </div>
      </Section>
      <Section title="Strategy snapshot" eyebrow="CEO view">
        <div style={chartGrid({ minCol: 320 })}>
          <ChartCard title="Firm size cohort" subtitle="TAM proxy: solo + small share" category="audience" activeCategory={category}>
            <CohortDonut data={effective.cohort} total={total} selected={filters.cohort} onSelect={(v) => onFilter('cohort', v)} />
          </ChartCard>
          <ChartCard title="Top-3 time-consuming tasks" subtitle="Weighted product wedge" category="practice" activeCategory={category}>
            <HorizontalBars
              data={effective.rankingsWeighted.map((b) => ({ value: b.value, label: labelFor('rankings', b.value), count: b.count }))}
              total={undefined}
              height={Math.max(260, effective.rankingsWeighted.length * 26)}
              accent
              selected={filters.rankings}
              onSelect={(v) => onFilter('rankings', v)}
            />
          </ChartCard>
          <ChartCard title="Recommendation Likert" subtitle="Likelihood to try on referral" category="concerns" activeCategory={category}>
            <OrderedBars buckets={effective.recommended} order={RECOMMENDED_ORDER} field="recommended" height={220} rotateTicks selected={filters.recommended} onSelect={(v) => onFilter('recommended', v)} />
          </ChartCard>
          <ChartCard title="Follow-up funnel" subtitle="Beta → interview → pilot → founder" category="funnel" activeCategory={category}>
            <FollowUpBars followUps={effective.followUps} total={total} />
          </ChartCard>
        </div>
      </Section>
    </>
  );
}

function CEOKpis({ effective }: { effective: RecomputedAggregates & { filteredTotal: number; filteredRows: NonPiiResponse[] } }) {
  const total = effective.filteredTotal;
  // % "would recommend ≥ 8/10" — approximated as very-likely + likely
  const positive = effective.recommended
    .filter((b) => b.value === 'very-likely' || b.value === 'likely')
    .reduce((a, b) => a + b.count, 0);
  const recommendShare = total > 0 ? Math.round((positive / total) * 100) : 0;
  const tamCohorts = effective.cohort
    .filter((b) => b.value === 'solo' || b.value === 'small')
    .reduce((a, b) => a + b.count, 0);
  const tamShare = total > 0 ? Math.round((tamCohorts / total) * 100) : 0;
  const completion = Math.round(((total > 0 ? total / Math.max(1, total) : 0)) * 100);
  return (
    <div className="stat-row">
      <Kpi label="Responses" value={total.toLocaleString()} />
      <Kpi label="% would recommend" value={`${recommendShare}%`} hint="Likely or very-likely" />
      <Kpi label="% TAM cohorts" value={`${tamShare}%`} hint="Solo + small firms" />
      <Kpi label="Beta opt-ins" value={effective.followUps.betaYes.toString()} />
      <Kpi label="Pilot opt-ins" value={(effective.followUps.pilotYes + effective.followUps.pilotMaybe).toString()} hint={`${effective.followUps.pilotYes} yes / ${effective.followUps.pilotMaybe} maybe`} />
      <Kpi label="Reach completion" value={`${completion}%`} hint="Of filtered set" />
    </div>
  );
}

// =============================================================================
// CFO layout - revenue & willingness to pay
// =============================================================================

function CFOLayout({ effective, filters, category, onFilter }: LayoutProps) {
  const total = effective.filteredTotal;
  return (
    <>
      <CFOKpis effective={effective} />
      <Section title="Revenue & willingness to pay" eyebrow="CFO view">
        <div style={chartGrid({ minCol: 320 })}>
          <ChartCard title="Spend by cohort" subtitle="Annual research + drafting" category="pricing" activeCategory={category} span={2}>
            <CohortStackedBars data={effective.spendByCohort} orderFor={(c) => SPEND_ORDER_BY_COHORT[c]} labelFor={(slug) => labelFor('spend', slug)} />
          </ChartCard>
          <ChartCard title="Willingness to pay by cohort" subtitle="Per user, per month" category="pricing" activeCategory={category} span={2}>
            <CohortStackedBars data={effective.willPayByCohort} orderFor={(c) => WILL_PAY_ORDER_BY_COHORT[c]} labelFor={(slug) => labelFor('willPay', slug)} />
          </ChartCard>
          <ChartCard title="Preferred pricing models" subtitle="Multi-select per response" category="pricing" activeCategory={category}>
            <HorizontalBars
              data={effective.pricingModel.map((b) => ({ value: b.value, label: labelFor('pricingModel', b.value), count: b.count }))}
              total={total}
              height={220}
              selected={filters.pricingModel}
              onSelect={(v) => onFilter('pricingModel', v)}
            />
          </ChartCard>
          <ChartCard title="Switching willingness" subtitle="Acceptable conditions for a 60-day trial" category="pricing" activeCategory={category}>
            <HorizontalBars
              data={effective.switching.map((b) => ({ value: b.value, label: labelFor('switching', b.value), count: b.count }))}
              total={undefined}
              height={220}
              selected={filters.switching}
              onSelect={(v) => onFilter('switching', v)}
            />
          </ChartCard>
        </div>
      </Section>
    </>
  );
}

function CFOKpis({ effective }: { effective: RecomputedAggregates & { filteredTotal: number; filteredRows: NonPiiResponse[] } }) {
  // "Top spend / will-pay bucket per cohort" + top pricing slug + % switch
  const topPricing = effective.pricingModel[0]?.value;
  const wouldSwitch = effective.switching
    .filter((b) => b.value === 'immediate' || b.value === 'backup' || b.value === 'parallel' || b.value === 'junior-first')
    .reduce((a, b) => a + b.count, 0);
  const totalSwitching = effective.switching.reduce((a, b) => a + b.count, 0);
  const switchShare = totalSwitching > 0 ? Math.round((wouldSwitch / totalSwitching) * 100) : 0;
  return (
    <div className="stat-row">
      <Kpi label="Responses" value={effective.filteredTotal.toLocaleString()} />
      <Kpi label="Top pricing model" value={topPricing ? labelFor('pricingModel', topPricing) : '—'} />
      <Kpi label="% open to switching" value={`${switchShare}%`} hint="Of those who answered switching" />
      <Kpi label="Pilot opt-ins" value={effective.followUps.pilotYes.toString()} hint={`${effective.followUps.pilotMaybe} more said maybe`} />
    </div>
  );
}

// =============================================================================
// CTO layout - tooling & integration
// =============================================================================

function CTOLayout({ effective, filters, category, onFilter }: LayoutProps) {
  const total = effective.filteredTotal;
  return (
    <>
      <CTOKpis effective={effective} />
      <Section title="Tooling & integration" eyebrow="CTO view">
        <div style={chartGrid({ minCol: 320 })}>
          <ChartCard title="Current AI usage" category="tools" activeCategory={category}>
            <OrderedBars buckets={effective.aiUsage} order={AI_USAGE_ORDER} field="aiUsage" height={220} rotateTicks selected={filters.aiUsage} onSelect={(v) => onFilter('aiUsage', v)} />
          </ChartCard>
          <ChartCard title="AI tools used (last 6 months)" subtitle="Among respondents who use or tried AI" category="tools" activeCategory={category}>
            <HorizontalBars
              data={effective.aiTools.map((b) => ({ value: b.value, label: labelFor('aiTools', b.value), count: b.count }))}
              total={undefined}
              height={Math.max(240, effective.aiTools.length * 24)}
              topN={14}
              selected={filters.aiTools}
              onSelect={(v) => onFilter('aiTools', v)}
            />
          </ChartCard>
          <ChartCard title="Case-management software" category="tools" activeCategory={category}>
            <HorizontalBars
              data={effective.caseMgmt.map((b) => ({ value: b.value, label: labelFor('caseMgmt', b.value), count: b.count }))}
              total={total}
              height={200}
              selected={filters.caseMgmt}
              onSelect={(v) => onFilter('caseMgmt', v)}
            />
          </ChartCard>
          <ChartCard title="E-filing systems" category="tools" activeCategory={category}>
            <HorizontalBars
              data={effective.efile.map((b) => ({ value: b.value, label: labelFor('efile', b.value), count: b.count }))}
              total={total}
              height={Math.max(220, effective.efile.length * 24)}
              topN={12}
              selected={filters.efile}
              onSelect={(v) => onFilter('efile', v)}
            />
          </ChartCard>
          <ChartCard title="Concerns radar" subtitle="Top concerns by share" category="concerns" activeCategory={category}>
            <ConcernRadar concerns={effective.concern} total={total} />
          </ChartCard>
          <ChartCard title="Required data location" category="concerns" activeCategory={category}>
            <HorizontalBars
              data={effective.dataLocation.map((b) => ({ value: b.value, label: labelFor('dataLocation', b.value), count: b.count }))}
              total={total}
              height={220}
              selected={filters.dataLocation}
              onSelect={(v) => onFilter('dataLocation', v)}
            />
          </ChartCard>
        </div>
      </Section>
    </>
  );
}

function CTOKpis({ effective }: { effective: RecomputedAggregates & { filteredTotal: number; filteredRows: NonPiiResponse[] } }) {
  const total = effective.filteredTotal;
  const aiActive = effective.aiUsage
    .filter((b) => b.value === 'daily' || b.value === 'weekly')
    .reduce((a, b) => a + b.count, 0);
  const aiShare = total > 0 ? Math.round((aiActive / total) * 100) : 0;

  const caseMgmtYes = effective.caseMgmt.find((b) => b.value === 'yes')?.count ?? 0;
  const cmShare = total > 0 ? Math.round((caseMgmtYes / total) * 100) : 0;

  const efileAny = total - (effective.efile.find((b) => b.value === 'none-efile')?.count ?? 0);
  const efileShare = total > 0 ? Math.round((efileAny / total) * 100) : 0;

  const top3Ai = effective.aiTools.slice(0, 3).map((b) => labelFor('aiTools', b.value)).join(', ') || '—';

  return (
    <div className="stat-row">
      <Kpi label="% AI weekly+" value={`${aiShare}%`} hint={`${aiActive} respondents`} />
      <Kpi label="% with case-mgmt" value={`${cmShare}%`} hint="Self-reported yes" />
      <Kpi label="% e-filing" value={`${efileShare}%`} hint="At least one portal" />
      <Kpi label="Top 3 AI tools" value={top3Ai} />
    </div>
  );
}

// =============================================================================
// Investor layout - traction + recent activity
// =============================================================================

function InvestorLayout({ stats, effective, filters, category, onFilter }: LayoutProps) {
  const total = effective.filteredTotal;
  return (
    <>
      <InvestorKpis stats={stats} effective={effective} />
      <Section title="Traction" eyebrow="Investor view">
        <div style={chartGrid({ minCol: 320 })}>
          <ChartCard title="Submissions over time" subtitle="Daily completed responses" category="funnel" activeCategory={category} span={2}>
            <SubmissionsLine timeseries={effective.timeseries} />
          </ChartCard>
          <ChartCard title="Follow-up opt-ins" subtitle="Demand signals" category="funnel" activeCategory={category}>
            <FollowUpBars followUps={effective.followUps} total={total} />
          </ChartCard>
          <ChartCard title="Firm size cohort" subtitle="TAM proxy" category="audience" activeCategory={category}>
            <CohortDonut data={effective.cohort} total={total} selected={filters.cohort} onSelect={(v) => onFilter('cohort', v)} />
          </ChartCard>
          <ChartCard title="Recommendation Likert" subtitle="Likelihood to try on referral" category="concerns" activeCategory={category}>
            <OrderedBars buckets={effective.recommended} order={RECOMMENDED_ORDER} field="recommended" height={220} rotateTicks selected={filters.recommended} onSelect={(v) => onFilter('recommended', v)} />
          </ChartCard>
        </div>
      </Section>
      {(category === 'all' || category === 'funnel') && (
        <Section title="Latest activity" eyebrow="Last 20 submissions">
          <RecentActivityTable rows={stats.recentActivity} />
        </Section>
      )}
    </>
  );
}

function InvestorKpis({ stats, effective }: {
  stats: DashboardStats;
  effective: RecomputedAggregates & { filteredTotal: number; filteredRows: NonPiiResponse[] };
}) {
  const total = effective.filteredTotal;
  return (
    <div className="stat-row">
      <Kpi label="Responses" value={total.toLocaleString()} />
      <Kpi label="Completion %" value={`${(stats.responses.completionRate * 100).toFixed(0)}%`} hint={`${stats.responses.draftsAbandoned} abandoned`} />
      <Kpi label="Last 30 days" value={stats.responses.last30Days.toLocaleString()} hint="New responses" />
      <Kpi label="Beta opt-ins" value={effective.followUps.betaYes.toString()} />
      <Kpi label="Pilot opt-ins" value={effective.followUps.pilotYes.toString()} hint={`${effective.followUps.pilotMaybe} more said maybe`} />
      <Kpi label="Founder call" value={effective.followUps.founderYes.toString()} hint="Yes" />
    </div>
  );
}

function RecentActivityTable({ rows }: { rows: RecentActivityRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="card-cream" style={{ padding: 20 }}>
        <p className="body-sm muted">No submissions yet in this window.</p>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Submitted</th>
            <th>Cohort</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.submittedAt}-${i}`}>
              <td className="mono" style={{ fontSize: 12 }}>{new Date(r.submittedAt).toLocaleString()}</td>
              <td>{cohortLabel(r.cohort)}</td>
              <td>{labelFor('role', r.role)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// Charts (extended with onSelect for cross-filter)
// =============================================================================

const PALETTE = ['#0A0A0A', '#404040', '#737373', '#A3A3A3', '#C8C8C8', '#E5E5E5'];

const axisTickBase = {
  fill: 'var(--text-tertiary)',
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
};
const axisTick      = axisTickBase as unknown as never;
const axisTickSans  = { ...axisTickBase, fontFamily: 'var(--font-sans)', fontSize: 12 } as unknown as never;
const axisTickSmall = { ...axisTickBase, fontSize: 10 } as unknown as never;

type FmtFn = (value: unknown, name?: unknown) => React.ReactNode;
const fmt = <T,>(fn: (v: number, name?: string) => T): FmtFn =>
  ((v: unknown, name?: unknown) => fn(Number(v ?? 0), name as string | undefined) as unknown as React.ReactNode);

const tooltipProps = {
  cursor: { fill: 'rgba(10,10,10,0.04)' },
  contentStyle: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-popover)',
    fontSize: 13,
    padding: '8px 10px',
  } as CSSProperties,
  labelStyle: {
    color: 'var(--text-primary)',
    fontWeight: 600,
    fontSize: 12,
    marginBottom: 2,
  } as CSSProperties,
  itemStyle: {
    color: 'var(--text-secondary)',
    padding: 0,
  } as CSSProperties,
};

function chartGrid({ minCol }: { minCol: number }): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fit, minmax(${minCol}px, 1fr))`,
    gap: 16,
  };
}

// Greyscale ramp used to encode magnitude in bar/donut fills. Darkest grey
// = highest count, lightest grey = lowest. Ramp length is wider than
// PALETTE so charts with many bars still get a perceptible gradient
// without bottoming out at white.
const SHADES = [
  '#0A0A0A', // 1
  '#262626', // 2
  '#404040', // 3
  '#595959', // 4
  '#737373', // 5
  '#8A8A8A', // 6
  '#A3A3A3', // 7
  '#BABABA', // 8
  '#D4D4D4', // 9
];

/** Given an array of counts, return a same-length array of grey hex strings
 *  ranked by count descending. Ties get the same shade. Bars with count 0
 *  go to the lightest end so they recede visually. */
function rankShades(counts: number[]): string[] {
  if (counts.length === 0) return [];
  // Rank by count desc - identical counts share a rank.
  const sorted = [...new Set(counts)].sort((a, b) => b - a);
  const rankByCount = new Map<number, number>();
  sorted.forEach((c, i) => rankByCount.set(c, i));
  const maxRank = sorted.length - 1;
  return counts.map((c) => {
    if (c === 0) return SHADES[SHADES.length - 1]!;
    const rank = rankByCount.get(c) ?? 0;
    // Spread the assigned ranks evenly across the ramp - keeps the gradient
    // smooth even when there are more bars than shades, and visible even
    // when there are fewer bars than shades.
    const idx = maxRank === 0 ? 0 : Math.round((rank / maxRank) * (SHADES.length - 1));
    return SHADES[idx]!;
  });
}

/** Fill for one bar/slice in a chart: prefers magnitude-shaded by default,
 *  but a cross-filter selection overrides (selected = black, others = light
 *  grey) so spatial context is preserved (per §8.2). */
function pickFill({ slug, selected, magnitudeShade, accent }: {
  slug: string;
  selected: string | undefined;
  magnitudeShade: string;
  accent?: boolean;
}): string {
  if (selected !== undefined) {
    return selected === slug ? 'var(--text-primary)' : '#D4D4D4';
  }
  // `accent` previously forced solid black for emphasis charts (rankings,
  // ordered bars). With magnitude shading we instead push the entire ramp
  // one step darker so the chart still reads "important" - but stays a
  // gradient rather than a flat colour.
  if (accent && magnitudeShade === SHADES[0]) return 'var(--text-primary)';
  return magnitudeShade;
}

// ---- HorizontalBars --------------------------------------------------------

interface HBarRow { value: string; label: string; count: number }

function HorizontalBars({
  data, total, height, topN, accent, selected, onSelect,
}: {
  data: HBarRow[];
  total?: number;
  height: number;
  topN?: number;
  accent?: boolean;
  selected?: string;
  onSelect?: (slug: string) => void;
}) {
  const sorted = [...data].sort((a, b) => b.count - a.count);
  const trimmed = topN ? sorted.slice(0, topN) : sorted;
  if (trimmed.length === 0) return <Placeholder label="No data" />;
  const shades = rankShades(trimmed.map((r) => r.count));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        layout="vertical"
        data={trimmed}
        margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
        barCategoryGap={4}
      >
        <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" horizontal={false} />
        <XAxis type="number" tick={axisTick} stroke="var(--border-default)" allowDecimals={false} />
        <YAxis type="category" dataKey="label" tick={axisTickSans} stroke="var(--border-default)" width={140} />
        <Tooltip
          {...tooltipProps}
          formatter={fmt((v) => {
            if (total && total > 0) return [`${v} (${Math.round((v / total) * 100)}%)`, 'Count'];
            return [v, 'Count'];
          })}
        />
        <Bar
          dataKey="count"
          isAnimationActive={false}
          radius={[0, 3, 3, 0]}
          maxBarSize={20}
          onClick={((d: unknown) => {
            const slug = (d as { payload?: { value?: string }; value?: string })?.payload?.value
              ?? (d as { value?: string })?.value;
            if (onSelect && typeof slug === 'string') onSelect(slug);
          }) as never}
          cursor={onSelect ? 'pointer' : 'default'}
        >
          {trimmed.map((row, i) => (
            <Cell key={i} fill={pickFill({ slug: row.value, selected, magnitudeShade: shades[i]!, accent })} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---- OrderedBars -----------------------------------------------------------

function OrderedBars({
  buckets, order, field, height, rotateTicks, selected, onSelect,
}: {
  buckets: BucketStat[];
  order: string[];
  field: string;
  height: number;
  rotateTicks?: boolean;
  selected?: string;
  onSelect?: (slug: string) => void;
}) {
  const map = new Map(buckets.map((b) => [b.value, b.count]));
  const data = order.map((v) => ({ value: v, label: labelFor(field, v), count: map.get(v) ?? 0 }));
  const shades = rankShades(data.map((d) => d.count));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, bottom: rotateTicks ? 32 : 8, left: -10 }}>
        <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="label"
          tick={axisTickSans}
          stroke="var(--border-default)"
          interval={0}
          angle={rotateTicks ? -20 : 0}
          textAnchor={rotateTicks ? 'end' : 'middle'}
          height={rotateTicks ? 56 : undefined}
        />
        <YAxis tick={axisTick} stroke="var(--border-default)" allowDecimals={false} />
        <Tooltip {...tooltipProps} formatter={fmt((v) => [v, 'Count'])} />
        <Bar
          dataKey="count"
          isAnimationActive={false}
          radius={[3, 3, 0, 0]}
          maxBarSize={48}
          onClick={((d: unknown) => {
            const slug = (d as { payload?: { value?: string }; value?: string })?.payload?.value
              ?? (d as { value?: string })?.value;
            if (onSelect && typeof slug === 'string') onSelect(slug);
          }) as never}
          cursor={onSelect ? 'pointer' : 'default'}
        >
          {data.map((row, i) => (
            <Cell key={i} fill={pickFill({ slug: row.value, selected, magnitudeShade: shades[i]!, accent: true })} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---- CohortDonut -----------------------------------------------------------

function CohortDonut({ data, total, selected, onSelect }: {
  data: BucketStat[];
  total: number;
  selected?: string;
  onSelect?: (slug: string) => void;
}) {
  if (total === 0) return <Placeholder label="No data" />;
  const ordered = COHORT_ORDER
    .map((c) => {
      const b = data.find((d) => d.value === c);
      return { name: cohortLabel(c), slug: c, value: b?.count ?? 0 };
    })
    .filter((d) => d.value > 0);
  const shades = rankShades(ordered.map((d) => d.value));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={ordered}
          dataKey="value"
          nameKey="name"
          innerRadius={56}
          outerRadius={86}
          stroke="var(--bg-surface)"
          strokeWidth={2}
          paddingAngle={2}
          isAnimationActive={false}
          onClick={((d: unknown) => {
            const slug = (d as { payload?: { slug?: string }; slug?: string })?.payload?.slug
              ?? (d as { slug?: string })?.slug;
            if (onSelect && typeof slug === 'string') onSelect(slug);
          }) as never}
          cursor={onSelect ? 'pointer' : 'default'}
        >
          {ordered.map((row, i) => (
            <Cell
              key={i}
              fill={pickFill({ slug: row.slug, selected, magnitudeShade: shades[i]! })}
            />
          ))}
        </Pie>
        <Tooltip
          {...tooltipProps}
          formatter={fmt((v, name) => [`${v} (${Math.round((v / total) * 100)}%)`, name ?? ''])}
        />
        <Legend
          verticalAlign="bottom"
          align="center"
          iconSize={9}
          formatter={(value: string) => (
            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ---- CohortStackedBars -----------------------------------------------------

function CohortStackedBars({ data, orderFor, labelFor: labelFn }: {
  data: CohortBucketStat[];
  orderFor: (cohort: Cohort) => string[];
  labelFor: (slug: string) => string;
}) {
  const slugSet = new Set<string>();
  for (const r of data) slugSet.add(r.value);

  const orderedSlugs: string[] = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const c of COHORT_ORDER) {
      for (const s of orderFor(c)) {
        if (slugSet.has(s) && !seen.has(s)) { out.push(s); seen.add(s); }
      }
    }
    for (const s of slugSet) if (!seen.has(s)) out.push(s);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  type Row = { cohort: string; label: string; [k: string]: number | string };
  const rows: Row[] = COHORT_ORDER.map((c) => {
    const row: Row = { cohort: c, label: cohortLabel(c) };
    for (const s of orderedSlugs) row[s] = 0;
    return row;
  });
  const idxByCohort = new Map<string, number>(rows.map((r, i) => [r.cohort as string, i]));
  for (const d of data) {
    const idx = idxByCohort.get(d.cohort);
    if (idx === undefined) continue;
    (rows[idx]![d.value] as number) = ((rows[idx]![d.value] as number) ?? 0) + d.count;
  }
  const visibleRows = rows.filter((r) => orderedSlugs.some((s) => (r[s] as number) > 0));
  if (visibleRows.length === 0 || orderedSlugs.length === 0) return <Placeholder label="No data" />;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={visibleRows} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 24 }}>
        <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" horizontal={false} />
        <XAxis type="number" tick={axisTick} stroke="var(--border-default)" allowDecimals={false} />
        <YAxis type="category" dataKey="label" tick={axisTickSans} stroke="var(--border-default)" width={120} />
        <Tooltip {...tooltipProps} formatter={fmt((v, name) => [v, labelFn(name ?? '')])} />
        <Legend
          verticalAlign="bottom"
          iconSize={8}
          formatter={(value: string) => (
            <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{labelFn(value)}</span>
          )}
          wrapperStyle={{ paddingTop: 6 }}
        />
        {orderedSlugs.map((slug, i) => (
          <Bar
            key={slug}
            dataKey={slug}
            stackId="spend"
            fill={PALETTE[i % PALETTE.length]}
            isAnimationActive={false}
            maxBarSize={26}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---- ConcernRadar ----------------------------------------------------------

function ConcernRadar({ concerns, total }: { concerns: BucketStat[]; total: number }) {
  if (total === 0 || concerns.length === 0) return <Placeholder label="No data" />;
  const top = [...concerns].sort((a, b) => b.count - a.count).slice(0, 8);
  const data = top.map((b) => ({
    label: labelFor('concern', b.value),
    share: Math.round((b.count / total) * 100),
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data} margin={{ top: 12, right: 24, bottom: 12, left: 24 }}>
        <PolarGrid stroke="var(--border-default)" />
        <PolarAngleAxis dataKey="label" tick={axisTickSmall} />
        <PolarRadiusAxis tick={axisTick} stroke="var(--border-default)" tickFormatter={(v: number) => `${v}%`} />
        <Tooltip {...tooltipProps} formatter={fmt((v) => [`${v}%`, 'Share'])} />
        <Radar
          dataKey="share"
          stroke="var(--text-primary)"
          fill="var(--text-primary)"
          fillOpacity={0.18}
          strokeWidth={2}
          isAnimationActive={false}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

// ---- SubmissionsLine + FollowUpBars (factored out for reuse) ---------------

function SubmissionsLine({ timeseries }: { timeseries: TimeseriesPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={timeseries} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
        <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="date"
          tick={axisTick}
          tickFormatter={(d: string) => d.slice(5)}
          interval="preserveStartEnd"
          stroke="var(--border-default)"
        />
        <YAxis tick={axisTick} allowDecimals={false} stroke="var(--border-default)" />
        <Tooltip {...tooltipProps} formatter={fmt((v) => [v, 'Responses'])} />
        <Line
          type="monotone"
          dataKey="count"
          stroke="var(--text-primary)"
          strokeWidth={2}
          dot={{ r: 3, fill: 'var(--text-primary)', strokeWidth: 0 }}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

function FollowUpBars({ followUps, total }: {
  followUps: RecomputedAggregates['followUps'];
  total: number;
}) {
  const data = [
    { value: 'beta',        label: 'Beta access',     count: followUps.betaYes },
    { value: 'interview',   label: 'Paid interview',  count: followUps.interviewYes },
    { value: 'pilot-yes',   label: 'Pilot — yes',     count: followUps.pilotYes },
    { value: 'pilot-maybe', label: 'Pilot — maybe',   count: followUps.pilotMaybe },
    { value: 'founder',     label: 'Founder call',    count: followUps.founderYes },
  ];
  return <HorizontalBars data={data} total={total} height={220} />;
}

// ---- FreeTextPanel ---------------------------------------------------------
//
// Voice-of-the-customer: shows the actual prose answers to the three open
// questions (`painOpen`, `aiWants`, `aiWish`) plus the smaller textareas
// (`firmDepartments`, `caseMgmtSpec`). Tabs above, scrollable list of
// quotes below, each tagged with cohort + role for context. Rows already
// filter via cross-filter chips so e.g. picking cohort=solo on the donut
// shrinks this panel to solo respondents only.

type QuoteField = 'painOpen' | 'aiWants' | 'aiWish' | 'firmDepartments' | 'caseMgmtSpec';

interface QuoteTab { value: QuoteField; label: string; prompt: string }
const QUOTE_TABS: QuoteTab[] = [
  { value: 'painOpen',        label: 'Pain points',  prompt: 'Most repetitive or frustrating tasks' },
  { value: 'aiWants',         label: 'Wanted',       prompt: 'AI features that would be most valuable' },
  { value: 'aiWish',          label: 'Wish-list',    prompt: 'A feature you wish existed but does not' },
  { value: 'firmDepartments', label: 'Departments',  prompt: 'Top departments by headcount (firm cohorts only)' },
  { value: 'caseMgmtSpec',    label: 'Case-mgmt',    prompt: 'Specific case-management software in use' },
];

function FreeTextPanel({ rows }: { rows: NonPiiResponse[] }) {
  const [active, setActive] = useState<QuoteField>('painOpen');
  const tab = QUOTE_TABS.find((t) => t.value === active)!;

  const quotes = useMemo(() => {
    return rows
      .map((r) => {
        const text = r[active];
        if (typeof text !== 'string' || text.trim() === '') return null;
        return {
          text: text.trim(),
          cohort: r.firmSize,
          role: r.role,
          submittedAt: r.submittedAt,
        };
      })
      .filter((q): q is NonNullable<typeof q> => q !== null)
      .slice(0, 50);
  }, [rows, active]);

  return (
    <div>
      <div className="pill-nav" style={{ marginBottom: 14 }}>
        {QUOTE_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            className={active === t.value ? 'active' : ''}
            onClick={() => setActive(t.value)}
            style={{
              background: active === t.value ? 'var(--text-primary)' : 'transparent',
              color: active === t.value ? 'var(--bg-base)' : 'var(--text-secondary)',
              fontSize: 12,
              padding: '6px 12px',
            }}
          >
            {t.label}
            <span style={{ marginLeft: 6, color: active === t.value ? 'var(--text-tertiary)' : 'var(--text-tertiary)', fontSize: 10 }}>
              ({rows.filter((r) => typeof r[t.value] === 'string' && (r[t.value] as string).trim() !== '').length})
            </span>
          </button>
        ))}
      </div>
      <p className="body-sm" style={{ color: 'var(--text-tertiary)', marginBottom: 12 }}>{tab.prompt}</p>
      {quotes.length === 0 ? (
        <Placeholder label="No quotes in this slice" />
      ) : (
        <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4 }}>
          {quotes.map((q, i) => (
            <article
              key={`${q.submittedAt}-${i}`}
              style={{
                background: 'var(--bg-surface-2)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 14px',
              }}
            >
              <p className="body-sm" style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap', marginBottom: 8 }}>
                "{q.text}"
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="badge">{cohortLabel(q.cohort)}</span>
                <span className="badge">{labelFor('role', q.role)}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                  {new Date(q.submittedAt).toLocaleDateString()}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Heatmap ---------------------------------------------------------------
//
// Hand-rolled SVG grid - recharts doesn't ship a heatmap. Each cell's fill
// is row-relative (the darkest in each row is the max for that row, lighter
// shades down to near-white for 0). Tooltip on hover shows raw count + row %.
// Uses the existing SHADES palette so we don't introduce a new colour ramp.

function Heatmap({ pair, rowLabelFn, colLabelFn, height = 260 }: {
  pair: PairMatrix;
  rowLabelFn: (slug: string) => string;
  colLabelFn: (slug: string) => string;
  height?: number;
}) {
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);
  if (pair.rowKeys.length === 0 || pair.colKeys.length === 0) {
    return <Placeholder label="No data" />;
  }
  const colW = 60;
  const rowH = 32;
  const labelW = 130;
  const labelH = 60;
  const gridW = labelW + pair.colKeys.length * colW;
  const gridH = labelH + pair.rowKeys.length * rowH;

  // Cell colour scale: 0 -> SHADES[last], rowMax -> SHADES[0]
  const shadeFor = (i: number, j: number): string => {
    const max = pair.rowTotals[i] ?? 0;
    if (max === 0) return SHADES[SHADES.length - 1]!;
    const share = (pair.counts[i]![j] ?? 0) / max;
    if (share === 0) return SHADES[SHADES.length - 1]!;
    const idx = Math.min(SHADES.length - 1, Math.max(0, Math.round((1 - share) * (SHADES.length - 1))));
    return SHADES[idx]!;
  };

  return (
    <div style={{ overflowX: 'auto', position: 'relative' }}>
      <svg width={gridW} height={Math.max(height, gridH)} role="img" aria-label="Heatmap">
        {/* Column labels (rotated) */}
        {pair.colKeys.map((ck, j) => (
          <g key={`col-${ck}`} transform={`translate(${labelW + j * colW + colW / 2}, ${labelH - 6})`}>
            <text
              transform="rotate(-35)"
              textAnchor="end"
              style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fill: 'var(--text-secondary)' }}
            >
              {truncate(colLabelFn(ck), 18)}
            </text>
          </g>
        ))}
        {/* Row labels */}
        {pair.rowKeys.map((rk, i) => (
          <text
            key={`row-${rk}`}
            x={labelW - 8}
            y={labelH + i * rowH + rowH / 2 + 4}
            textAnchor="end"
            style={{ fontFamily: 'var(--font-sans)', fontSize: 12, fill: 'var(--text-secondary)' }}
          >
            {truncate(rowLabelFn(rk), 16)}
          </text>
        ))}
        {/* Cells */}
        {pair.rowKeys.map((_, i) =>
          pair.colKeys.map((_, j) => {
            const count = pair.counts[i]![j] ?? 0;
            const rowTotal = pair.rowTotals[i] ?? 0;
            const isHover = hover?.i === i && hover?.j === j;
            return (
              <g
                key={`cell-${i}-${j}`}
                onMouseEnter={() => setHover({ i, j })}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x={labelW + j * colW + 1}
                  y={labelH + i * rowH + 1}
                  width={colW - 2}
                  height={rowH - 2}
                  rx={3}
                  fill={shadeFor(i, j)}
                  stroke={isHover ? 'var(--text-primary)' : 'transparent'}
                  strokeWidth={isHover ? 2 : 0}
                />
                <text
                  x={labelW + j * colW + colW / 2}
                  y={labelH + i * rowH + rowH / 2 + 4}
                  textAnchor="middle"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    fill: count > 0 && rowTotal > 0 && count / rowTotal > 0.5 ? 'var(--bg-base)' : 'var(--text-primary)',
                    pointerEvents: 'none',
                  }}
                >
                  {count}
                </text>
              </g>
            );
          }),
        )}
      </svg>
      {hover && pair.counts[hover.i] && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            padding: '6px 10px',
            fontSize: 12,
            color: 'var(--text-primary)',
            boxShadow: 'var(--shadow-popover)',
            pointerEvents: 'none',
          }}
        >
          <strong>{rowLabelFn(pair.rowKeys[hover.i]!)}</strong>
          {' × '}
          <strong>{colLabelFn(pair.colKeys[hover.j]!)}</strong>
          <br />
          {pair.counts[hover.i]![hover.j]} ({pair.rowTotals[hover.i]! > 0
            ? `${Math.round((pair.counts[hover.i]![hover.j]! / pair.rowTotals[hover.i]!) * 100)}% of row`
            : '—'})
        </div>
      )}
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---- TopOpportunities ------------------------------------------------------
//
// Derived "build priority" score per ranked-task slug:
//   weightShare = sum(rank-weight 3/2/1) / total weight  → 0..1
//   willPayPct  = avg of cohort-normalised willPay percentile of pickers
//   score       = weightShare × willPayPct               → 0..1
// Rendered as a sortable table with three columns visualised as inline bars.

function TopOpportunities({ opportunities }: { opportunities: Opportunity[] }) {
  if (opportunities.length === 0) return <Placeholder label="No rankings data" />;
  const top = opportunities.slice(0, 12);
  const maxScore = top[0]?.score ?? 1;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: '36%' }}>Task</th>
            <th style={{ width: '14%' }}>Pickers</th>
            <th style={{ width: '20%' }}>Pain weight</th>
            <th style={{ width: '20%' }}>Avg ₹ willingness</th>
            <th style={{ width: '10%' }}>Score</th>
          </tr>
        </thead>
        <tbody>
          {top.map((o) => (
            <tr key={o.task}>
              <td>{labelFor('rankings', o.task)}</td>
              <td className="mono" style={{ fontSize: 12 }}>{o.pickers}</td>
              <td><InlineBar value={o.weightShare} max={1} display={`${Math.round(o.weightShare * 100)}%`} /></td>
              <td><InlineBar value={o.willPayPct} max={1} display={`${Math.round(o.willPayPct * 100)}%`} /></td>
              <td>
                <InlineBar
                  value={o.score}
                  max={Math.max(maxScore, 0.001)}
                  display={(o.score * 100).toFixed(1)}
                  accent
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InlineBar({ value, max, display, accent }: {
  value: number; max: number; display: string; accent?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1,
        height: 6,
        background: 'var(--bg-surface-2)',
        borderRadius: 'var(--radius-full)',
        overflow: 'hidden',
        minWidth: 50,
      }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: accent ? 'var(--text-primary)' : '#404040',
        }} />
      </div>
      <span className="mono" style={{ fontSize: 11, minWidth: 36, textAlign: 'right', color: 'var(--text-secondary)' }}>
        {display}
      </span>
    </div>
  );
}

// ---- CohortSankey ----------------------------------------------------------
//
// cohort → AI usage → willingness-to-pay tier. Three columns of nodes, each
// link's thickness = response count. Recharts Sankey is used directly with
// a monochrome Cell-style node colour (rank-shaded if we wanted; kept solid
// for now to keep the chart readable).

function CohortSankey({ data }: { data: SankeyData }) {
  if (data.links.length === 0) return <Placeholder label="No data" />;
  return (
    <ResponsiveContainer width="100%" height={300}>
      <Sankey
        data={data}
        nodePadding={20}
        nodeWidth={10}
        margin={{ left: 4, right: 100, top: 8, bottom: 8 }}
        link={{ stroke: '#A3A3A3', strokeOpacity: 0.4 } as never}
        node={{ fill: 'var(--text-primary)', stroke: 'var(--bg-surface)' } as never}
      >
        <Tooltip {...tooltipProps} formatter={fmt((v) => [v, 'Respondents'])} />
      </Sankey>
    </ResponsiveContainer>
  );
}

// ---- Placeholder + shared error banner -------------------------------------

function Placeholder({ label }: { label: string }) {
  return (
    <div style={{
      height: 220,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--text-tertiary)',
      fontSize: 13,
      border: '1px dashed var(--border-default)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--bg-surface-2)',
    }}>{label}</div>
  );
}

const pageShellStyle: CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg-base)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};

const errorBanner: CSSProperties = {
  marginTop: 14,
  fontSize: 13,
  color: 'var(--danger)',
  background: 'var(--danger-bg)',
  border: '1px solid var(--danger)',
  borderRadius: 'var(--radius-md)',
  padding: '10px 12px',
};
