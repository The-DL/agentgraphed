// Next.js calls this hook exactly once per server boot, before any request
// is served. We start a single global timer that re-scans the Claude / Codex
// log directories on a 5-minute cadence so the dashboard stays current even
// when no tab is open.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startPeriodicIngest } = await import('./lib/ingest/scheduler');
  startPeriodicIngest();
}
