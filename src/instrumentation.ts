// Next.js calls this hook exactly once per server boot, before any request
// is served. We use it to start a single global timer that re-scans the
// Claude / Codex log directories on a 5-minute cadence — so the dashboard
// stays current even if the user never refreshes a tab.
//
// Why this exists: dashboard renders also call `triggerBackgroundIngest()`,
// so an active user gets fresh data within the 10s debounce. But if the
// tab is closed (or just idle) for hours, the only thing that brings new
// sessions in was a page reload. The interval here closes that gap.

export async function register() {
  // Next runs `register` for both nodejs and edge runtimes. Skip the edge
  // runtime — we need fs / better-sqlite3, neither of which exist there.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Dynamic import so the module graph stays cold until we're on the node
  // runtime (Next's edge bundler would otherwise try to follow the chain
  // into better-sqlite3 native code).
  const { startPeriodicIngest } = await import('./lib/ingest/scheduler');
  startPeriodicIngest();
}
