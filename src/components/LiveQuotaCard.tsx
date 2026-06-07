'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Snapshot = {
  observedAt: number;
  planType: string | null;
  primary: { pct: number; resetsAt: number; status: string | null } | null;
  secondary: { pct: number; resetsAt: number; status: string | null } | null;
  tokenWasRefreshed: boolean;
};

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; snap: Snapshot }
  | { kind: 'err'; error: string };

const POLL_INTERVAL_MS = 60_000;
const LOCAL_STORAGE_KEY = 'agentgraphed.quota.autopoll';

function fmtRelative(ts: number): string {
  const ms = ts - Date.now();
  if (ms <= 0) return 'resetting…';
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function Bar({ pct, accent = 'bg-primary' }: { pct: number; accent?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
      <div className={`h-full ${accent}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function LiveQuotaCard() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [autoPoll, setAutoPoll] = useState(false);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore auto-poll preference on mount; off by default.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
      if (stored === 'on') setAutoPoll(true);
    } catch { /* ignore */ }
  }, []);

  const runProbe = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((s) => (s.kind === 'ok' ? s : { kind: 'loading' }));
    try {
      const resp = await fetch('/api/quota-probe', { method: 'POST' });
      const body = (await resp.json()) as
        | { ok: true; snapshot: Snapshot }
        | { ok: false; error: string };
      if (body.ok) setState({ kind: 'ok', snap: body.snapshot });
      else setState({ kind: 'err', error: body.error });
    } catch (e) {
      setState({ kind: 'err', error: (e as Error).message });
    } finally {
      inFlight.current = false;
    }
  }, []);

  // Manage the auto-poll interval.
  useEffect(() => {
    if (!autoPoll) {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
      return;
    }
    runProbe(); // immediate probe on enable
    timer.current = setInterval(runProbe, POLL_INTERVAL_MS);
    return () => {
      if (timer.current) { clearInterval(timer.current); timer.current = null; }
    };
  }, [autoPoll, runProbe]);

  function toggleAutoPoll(next: boolean) {
    setAutoPoll(next);
    try { window.localStorage.setItem(LOCAL_STORAGE_KEY, next ? 'on' : 'off'); } catch { /* ignore */ }
  }

  const snap = state.kind === 'ok' ? state.snap : null;
  const err = state.kind === 'err' ? state.error : null;
  const isLoading = state.kind === 'loading';

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <span>Live Quota · Anthropic</span>
        <div className="flex items-center gap-2 normal-case tracking-normal">
          <label className="text-[11px] text-ink-mute flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={autoPoll}
              onChange={(e) => toggleAutoPoll(e.target.checked)}
              className="accent-primary"
            />
            Poll every 60s
          </label>
          <button
            onClick={runProbe}
            disabled={isLoading}
            className="btn !h-7 !px-2 text-[11px] disabled:opacity-50"
          >
            {isLoading ? 'Probing…' : 'Probe now'}
          </button>
        </div>
      </div>

      <div className="p-4">
        {snap ? (
          <div className="space-y-4">
            <QuotaRow
              label="5-hour window"
              snap={snap.primary}
              fallback="Not reported"
            />
            <QuotaRow
              label="7-day window"
              snap={snap.secondary}
              fallback="Not reported"
              accent="bg-secondary"
            />
            <div className="flex items-center justify-between text-[11px] text-ink-mute">
              <span>
                {snap.planType ? `Plan: ${snap.planType}` : 'Plan: unknown'}
                {snap.tokenWasRefreshed && <span className="ml-2">· token refreshed</span>}
              </span>
              <span className="font-mono tabular">
                Updated {fmtSince(snap.observedAt)} ago
              </span>
            </div>
          </div>
        ) : err ? (
          <div className="text-body-sm text-ink-dim">
            <div className="text-error mb-1">Probe failed</div>
            <div>{err}</div>
          </div>
        ) : (
          <div className="text-body-sm text-ink-mute">
            One probe costs ~$0.00006 (a single token on Haiku 4.5). Continuous polling at 60s is roughly $0.09/day.
            Off by default. Click <em>Probe now</em> or enable <em>Poll every 60s</em>.
          </div>
        )}
      </div>
    </div>
  );
}

function QuotaRow({
  label,
  snap,
  fallback,
  accent,
}: {
  label: string;
  snap: { pct: number; resetsAt: number; status: string | null } | null;
  fallback: string;
  accent?: string;
}) {
  if (!snap) {
    return (
      <div>
        <div className="flex items-baseline justify-between text-body-sm mb-1">
          <span className="text-ink">{label}</span>
          <span className="text-ink-mute font-mono text-code-sm">{fallback}</span>
        </div>
        <Bar pct={0} accent={accent} />
      </div>
    );
  }
  const pct = Math.round(snap.pct);
  const statusColor =
    snap.status === 'allowed_warning' || pct >= 80 ? 'text-secondary' :
    snap.status === 'allowed' || pct < 80 ? 'text-ink' :
    'text-error';
  return (
    <div>
      <div className="flex items-baseline justify-between text-body-sm mb-1">
        <span className="text-ink">{label}</span>
        <span className="font-mono text-code-sm tabular">
          <span className={statusColor}>{pct}%</span>
          <span className="text-ink-mute"> · resets in {fmtRelative(snap.resetsAt)}</span>
        </span>
      </div>
      <Bar pct={pct} accent={accent} />
    </div>
  );
}

function fmtSince(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 1000) return 'just now';
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}
