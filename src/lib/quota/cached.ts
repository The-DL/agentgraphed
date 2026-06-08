// Server-side cached live-quota readers.
//
// Each call returns the freshest snapshot for a provider, probing
// Anthropic / OpenAI only when the last persisted snapshot is older than
// QUOTA_CACHE_MS (60s). Otherwise we read the snapshot row straight from
// SQLite — zero network, zero API cost.
//
// Design note: we deliberately probe *synchronously* on cache miss, not
// background-fire-and-forget. Auto-ingest fires-and-forgets because the
// dashboard is still useful with one-render-stale local data. Quota is
// different — the user just landed on the dashboard wanting to see their
// usage. Better to wait ~500ms once than show "—" and update half a
// second later.

import { getSqlite } from '@/lib/db/client';
import { probeClaudeQuota } from './probe';
import { probeCodexQuota } from './codex';

const QUOTA_CACHE_MS = 60_000;

export type QuotaKpi = {
  provider: 'claude' | 'codex';
  ok: boolean;
  observedAt: number;
  planType: string | null;
  primary: { pct: number; resetsAt: number; label: string } | null;
  secondary: { pct: number; resetsAt: number; label: string } | null;
  error?: string;
};

type SnapshotRow = {
  provider: string;
  observed_at: number;
  plan_type: string | null;
  primary_pct: number | null;
  primary_window_minutes: number | null;
  primary_resets_at: number | null;
  secondary_pct: number | null;
  secondary_window_minutes: number | null;
  secondary_resets_at: number | null;
};

function persist(provider: 'claude' | 'codex', kpi: QuotaKpi): void {
  if (!kpi.ok) return;
  getSqlite()
    .prepare(
      `INSERT OR REPLACE INTO quota_snapshots (
         provider, observed_at, plan_type,
         primary_pct, primary_window_minutes, primary_resets_at,
         secondary_pct, secondary_window_minutes, secondary_resets_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      provider,
      kpi.observedAt,
      kpi.planType,
      kpi.primary ? Math.round(kpi.primary.pct * 10) / 10 : null,
      kpi.primary ? (provider === 'claude' ? 300 : 1) : null,
      kpi.primary ? kpi.primary.resetsAt : null,
      kpi.secondary ? Math.round(kpi.secondary.pct * 10) / 10 : null,
      kpi.secondary ? 7 * 24 * 60 : null,
      kpi.secondary ? kpi.secondary.resetsAt : null,
    );
}

function readCached(provider: 'claude' | 'codex'): QuotaKpi | null {
  const row = getSqlite()
    .prepare('SELECT * FROM quota_snapshots WHERE provider = ?')
    .get(provider) as SnapshotRow | undefined;
  if (!row) return null;
  if (Date.now() - row.observed_at > QUOTA_CACHE_MS) return null;
  return {
    provider,
    ok: true,
    observedAt: row.observed_at,
    planType: row.plan_type,
    primary: row.primary_pct !== null && row.primary_resets_at !== null
      ? { pct: row.primary_pct, resetsAt: row.primary_resets_at, label: provider === 'claude' ? '5h' : '1m' }
      : null,
    secondary: row.secondary_pct !== null && row.secondary_resets_at !== null
      ? { pct: row.secondary_pct, resetsAt: row.secondary_resets_at, label: '7d' }
      : null,
  };
}

export async function getClaudeQuotaKpi(): Promise<QuotaKpi> {
  const cached = readCached('claude');
  if (cached) return cached;

  const result = await probeClaudeQuota();
  if (!result.ok) {
    return { provider: 'claude', ok: false, observedAt: Date.now(), planType: null, primary: null, secondary: null, error: result.error };
  }
  const kpi: QuotaKpi = {
    provider: 'claude',
    ok: true,
    observedAt: result.observedAt,
    planType: result.planType,
    primary: result.primary ? { pct: result.primary.utilization * 100, resetsAt: result.primary.resetsAt, label: '5h' } : null,
    secondary: result.secondary ? { pct: result.secondary.utilization * 100, resetsAt: result.secondary.resetsAt, label: '7d' } : null,
  };
  persist('claude', kpi);
  return kpi;
}

export async function getCodexQuotaKpi(): Promise<QuotaKpi> {
  const cached = readCached('codex');
  if (cached) return cached;

  const result = await probeCodexQuota();
  if (!result.ok) {
    return { provider: 'codex', ok: false, observedAt: Date.now(), planType: null, primary: null, secondary: null, error: result.error };
  }
  const kpi: QuotaKpi = {
    provider: 'codex',
    ok: true,
    observedAt: result.observedAt,
    planType: result.planType,
    primary: result.primary ? { pct: result.primary.utilization * 100, resetsAt: result.primary.resetsAt, label: '1m' } : null,
    secondary: null,
  };
  persist('codex', kpi);
  return kpi;
}
