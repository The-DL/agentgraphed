import { triggerBackgroundIngest } from './auto';

// 5 minutes is the sweet spot: short enough that an idle dashboard feels
// fresh, long enough that we're not pounding the file system on a quiet box.
// Both bounds are deliberate — `triggerBackgroundIngest` itself debounces at
// 10s, so we don't risk a runaway loop even if this constant gets tuned down
// accidentally.
const TICK_MS = 5 * 60_000;

// Module-level guard: Next.js will call our `register()` once per process,
// but dev hot-reloads or accidental double-imports could call this again.
// A symbol on globalThis survives module re-evaluation without leaking.
const KEY = Symbol.for('agentgraphed.periodic-ingest');
type Global = typeof globalThis & { [KEY]?: NodeJS.Timeout };

export function startPeriodicIngest(): void {
  const g = globalThis as Global;
  if (g[KEY]) return;

  // Fire once on boot — covers the gap between the process starting and the
  // first dashboard render. `triggerBackgroundIngest` returns immediately
  // and runs the actual scan in the background.
  triggerBackgroundIngest();

  g[KEY] = setInterval(() => {
    triggerBackgroundIngest();
  }, TICK_MS);

  // Don't keep the event loop alive solely for this timer — if the server
  // is shutting down, we don't want to block the exit.
  if (typeof g[KEY]?.unref === 'function') g[KEY]!.unref();
}
