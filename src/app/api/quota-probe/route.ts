// POST /api/quota-probe — run one live probe against Anthropic and persist the
// resulting snapshot. Returns the snapshot for the UI to render.
//
// This is a SOLO-USER, LOCAL-ONLY endpoint: it reads the user's own Claude
// Code OAuth token from disk and probes Anthropic with it. It is never reached
// from any hosted/team-tier code path — that surface was intentionally removed.
//
// Cost: one probe is ~1 input + 1 output token on Haiku 4.5 (~$0.00006).
// Polling at 60s = ~$0.086/day. Fully opt-in: the dashboard surfaces a button
// + a Settings toggle for auto-poll, both default off.

import { probeClaudeQuota } from '@/lib/quota/probe';
import { getSqlite } from '@/lib/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const result = await probeClaudeQuota();
  if (!result.ok) {
    return new Response(JSON.stringify({ ok: false, error: result.error, httpStatus: result.httpStatus }), {
      status: 200, // 200 with ok:false so the UI gets the structured error
      headers: { 'content-type': 'application/json' },
    });
  }

  const db = getSqlite();
  db.prepare(
    `INSERT OR REPLACE INTO quota_snapshots (
       provider, observed_at, plan_type,
       primary_pct, primary_window_minutes, primary_resets_at,
       secondary_pct, secondary_window_minutes, secondary_resets_at
     ) VALUES ('claude', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    result.observedAt,
    result.planType,
    result.primary ? Math.round(result.primary.utilization * 1000) / 10 : null, // 0-100, one decimal
    result.primary ? 300 : null,                                                 // 5h window
    result.primary ? result.primary.resetsAt : null,
    result.secondary ? Math.round(result.secondary.utilization * 1000) / 10 : null,
    result.secondary ? 7 * 24 * 60 : null,
    result.secondary ? result.secondary.resetsAt : null,
  );

  return new Response(JSON.stringify({
    ok: true,
    snapshot: {
      observedAt: result.observedAt,
      planType: result.planType,
      primary: result.primary
        ? { pct: result.primary.utilization * 100, resetsAt: result.primary.resetsAt, status: result.primary.status }
        : null,
      secondary: result.secondary
        ? { pct: result.secondary.utilization * 100, resetsAt: result.secondary.resetsAt, status: result.secondary.status }
        : null,
      tokenWasRefreshed: result.tokenWasRefreshed,
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}
