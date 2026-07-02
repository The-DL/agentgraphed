import { homedir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { getSetting } from '../queries';

export type Source = { path: string; tag: string };

// Pure: clean a raw JSON settings array into a source list. No fallback —
// returns [] when nothing valid, so callers can decide the default.
export function parseSourceRows(rawJson: string | null): Source[] {
  if (!rawJson) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(rawJson);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: Source[] = [];
  const seen = new Set<string>();
  for (const e of arr) {
    if (!e || typeof e !== 'object') continue;
    const path = String((e as { path?: unknown }).path ?? '').trim();
    if (!path || seen.has(path)) continue;
    const tag = String((e as { tag?: unknown }).tag ?? '').trim().slice(0, 60) || 'default';
    seen.add(path);
    out.push({ path, tag });
  }
  return out;
}

// Pure: like parseSourceRows, but guarantees at least one source by falling
// back to `fallbackPath` tagged "default".
export function resolveSources(rawJson: string | null, fallbackPath: string): Source[] {
  const rows = parseSourceRows(rawJson);
  if (rows.length > 0) return rows;
  return [{ path: fallbackPath, tag: 'default' }];
}

// The directory a provider falls back to when no explicit source list is
// saved: legacy single-dir setting → env var → hardcoded default. Exported so
// the settings UI can show the effective fallback as a placeholder without
// baking it into a saved row.
export function fallbackPath(provider: 'claude' | 'codex'): string {
  return provider === 'claude'
    ? getSetting('claude_log_dir') ||
        process.env.AGENTGRAPHED_CLAUDE_DIR ||
        process.env.AGENTGRAPH_CLAUDE_DIR ||
        join(homedir(), '.claude', 'projects')
    : getSetting('codex_log_dir') ||
        process.env.AGENTGRAPHED_CODEX_DIR ||
        process.env.AGENTGRAPH_CODEX_DIR ||
        join(homedir(), '.codex', 'sessions');
}

// Effective sources for a provider: the saved JSON list, else the legacy
// single-dir setting → env var → hardcoded default, tagged "default".
export function getSources(provider: 'claude' | 'codex'): Source[] {
  return resolveSources(getSetting(`${provider}_sources`), fallbackPath(provider));
}

// Gather files across every configured source, tagging each file with its
// source. Shared by both ingesters so the dedup semantics can't drift.
// Dedup is by canonical (real) path so two sources aliasing the same physical
// directory — a symlink, a trailing-slash variant — can't ingest the same
// session twice under two tags; the first source in config order wins.
export function gatherTaggedFiles(
  sources: Source[],
  listFiles: (path: string) => string[],
): Array<{ file: string; tag: string }> {
  const out: Array<{ file: string; tag: string }> = [];
  const seen = new Set<string>();
  for (const src of sources) {
    for (const f of listFiles(src.path)) {
      let key: string;
      try {
        key = realpathSync(f);
      } catch {
        key = f;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ file: f, tag: src.tag });
    }
  }
  return out;
}
