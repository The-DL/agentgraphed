import type { QuotaKpi } from '@/lib/quota/cached';

// Compact KPI card matching MetricCard's footprint. Renders both windows
// stacked (5h + 7d for Claude, 1m for Codex). Live quota becomes just
// another stat alongside Tokens/Sessions/Projects/Cost.

const PROVIDER_LABEL: Record<QuotaKpi['provider'], string> = {
  claude: 'Claude · Live',
  codex: 'Codex · Live',
};

function fmtRelative(ts: number): string {
  const ms = ts - Date.now();
  if (ms <= 0) return 'now';
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 1) return '<1m';
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

function Bar({ pct, accent }: { pct: number; accent: 'primary' | 'secondary' }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = accent === 'primary' ? 'bg-primary' : 'bg-secondary';
  return (
    <div className="h-1 bg-surface-2 rounded-full overflow-hidden mt-1">
      <div className={`h-full ${color}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

function Row({
  label,
  pct,
  resetsAt,
  accent,
}: {
  label: string;
  pct: number;
  resetsAt: number;
  accent: 'primary' | 'secondary';
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] text-ink-mute font-mono uppercase tracking-wide">{label}</span>
        <span className="text-body-md text-ink font-mono tabular">{Math.round(pct)}%</span>
      </div>
      <Bar pct={pct} accent={accent} />
      <div className="text-[10px] text-ink-mute font-mono tabular mt-0.5">
        resets in {fmtRelative(resetsAt)}
      </div>
    </div>
  );
}

export function QuotaKpiCard({ kpi }: { kpi: QuotaKpi }) {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="metric-label">{PROVIDER_LABEL[kpi.provider]}</div>
        {kpi.ok && kpi.planType && (
          <span className="text-[10px] text-ink-mute font-mono uppercase tracking-wide">
            {kpi.planType}
          </span>
        )}
      </div>

      {kpi.ok ? (
        <>
          {kpi.primary && (
            <Row
              label={kpi.primary.label}
              pct={kpi.primary.pct}
              resetsAt={kpi.primary.resetsAt}
              accent="primary"
            />
          )}
          {kpi.secondary && (
            <Row
              label={kpi.secondary.label}
              pct={kpi.secondary.pct}
              resetsAt={kpi.secondary.resetsAt}
              accent="secondary"
            />
          )}
          {!kpi.primary && !kpi.secondary && (
            <div className="text-body-sm text-ink-mute">No rate-limit headers returned.</div>
          )}
        </>
      ) : (
        <div className="text-[11px] text-ink-mute leading-relaxed">
          {kpi.error || 'Probe failed.'}
        </div>
      )}
    </div>
  );
}
