import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

// =============================================================================
// DateRangePicker - two .input fields + popover calendar, no new dependencies.
//
// Built from scratch with the design-system tokens (.datepicker-day,
// .datepicker-nav already live in globals.css). Presets sit above the
// calendar as a .pill-nav row: Last 7d / 30d / 90d / All time / Custom.
//
// Emits ISO yyyy-mm-dd strings (or null for "no bound"). The parent owns
// the from/to state and persists it to the URL.
// =============================================================================

export interface DateRangeValue {
  from: string | null; // ISO yyyy-mm-dd
  to:   string | null;
}

type Preset = 'last7' | 'last30' | 'last90' | 'all' | 'custom';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function offsetIso(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function detectPreset(v: DateRangeValue): Preset {
  if (!v.from && !v.to) return 'all';
  if (v.to !== todayIso()) return 'custom';
  if (v.from === offsetIso(6))  return 'last7';
  if (v.from === offsetIso(29)) return 'last30';
  if (v.from === offsetIso(89)) return 'last90';
  return 'custom';
}

function presetLabel(p: Preset): string {
  switch (p) {
    case 'last7':  return 'Last 7 days';
    case 'last30': return 'Last 30 days';
    case 'last90': return 'Last 90 days';
    case 'all':    return 'All time';
    case 'custom': return 'Custom';
  }
}

export function DateRangePicker({ value, onChange }: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const preset = detectPreset(value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const applyPreset = (p: Preset) => {
    switch (p) {
      case 'last7':  onChange({ from: offsetIso(6),  to: todayIso() }); break;
      case 'last30': onChange({ from: offsetIso(29), to: todayIso() }); break;
      case 'last90': onChange({ from: offsetIso(89), to: todayIso() }); break;
      case 'all':    onChange({ from: null,          to: null });        break;
      case 'custom':
        if (!value.from && !value.to) {
          onChange({ from: offsetIso(29), to: todayIso() });
        }
        break;
    }
  };

  const displayLabel = useMemo(() => {
    if (preset !== 'custom') return presetLabel(preset);
    if (value.from && value.to) return `${value.from}  →  ${value.to}`;
    if (value.from)             return `From ${value.from}`;
    if (value.to)               return `Until ${value.to}`;
    return 'All time';
  }, [preset, value]);

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
      >
        <span style={{ color: 'var(--text-tertiary)', marginRight: 6 }}>RANGE</span>
        <span style={{ color: 'var(--text-primary)' }}>{displayLabel}</span>
        <span aria-hidden style={{ marginLeft: 8, color: 'var(--text-tertiary)' }}>▾</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Date range"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-popover)',
            padding: 16,
            zIndex: 50,
            minWidth: 320,
          }}
        >
          {/* Preset pill row */}
          <div className="pill-nav" style={{ marginBottom: 14, width: '100%', justifyContent: 'space-between' }}>
            {(['last7', 'last30', 'last90', 'all', 'custom'] as Preset[]).map((p) => (
              <button
                key={p}
                type="button"
                className={preset === p ? 'active' : ''}
                onClick={() => applyPreset(p)}
                style={{ fontSize: 12, padding: '6px 12px' }}
              >
                {presetLabel(p)}
              </button>
            ))}
          </div>

          {/* Two date fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label className="label" htmlFor="dr-from">From</label>
              <input
                id="dr-from"
                type="date"
                className="input"
                value={value.from ?? ''}
                onChange={(e) => onChange({ from: e.target.value || null, to: value.to })}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
              />
            </div>
            <div>
              <label className="label" htmlFor="dr-to">To</label>
              <input
                id="dr-to"
                type="date"
                className="input"
                value={value.to ?? ''}
                onChange={(e) => onChange({ from: value.from, to: e.target.value || null })}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => { onChange({ from: null, to: null }); setOpen(false); }}
            >
              Clear
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export const dateRangeCss: CSSProperties = {}; // export hook for parent layouts (unused)
