import { PageHeader } from '@/components/PageHeader';
import { LlmSection } from '@/components/LlmSection';
import { SourceList } from '@/components/SourceList';
import { fallbackPath, parseSourceRows } from '@/lib/ingest/sources';
import { getSetting, setSetting } from '@/lib/queries';
import { PRICES_LAST_UPDATED } from '@/lib/pricing';
import { runIngest } from '@/lib/ingest/run';
import { defaultModel, type LlmProvider } from '@/lib/llm/models';
import { revalidatePath } from 'next/cache';
import { dataDir } from '@/lib/db/paths';
import { getSqlite } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

async function savePaths(formData: FormData) {
  'use server';
  // Clean + re-serialize each list so we never persist junk rows. An empty
  // list is stored as "[]", which makes getSources() fall back to the
  // env var / hardcoded default, tagged "default".
  const claude = parseSourceRows((formData.get('claude_sources') as string) || '[]');
  const codex = parseSourceRows((formData.get('codex_sources') as string) || '[]');

  // Detect whether the effective config actually changed before writing, so a
  // no-op resubmit doesn't wipe the ingest cache below.
  const prevClaude = JSON.stringify(parseSourceRows(getSetting('claude_sources')));
  const prevCodex = JSON.stringify(parseSourceRows(getSetting('codex_sources')));
  const legacyClaude = getSetting('claude_log_dir') || '';
  const legacyCodex = getSetting('codex_log_dir') || '';
  const changed =
    prevClaude !== JSON.stringify(claude) ||
    prevCodex !== JSON.stringify(codex) ||
    legacyClaude !== '' ||
    legacyCodex !== '';

  setSetting('claude_sources', JSON.stringify(claude));
  setSetting('codex_sources', JSON.stringify(codex));
  // An explicit save makes the source lists the single point of truth: clear
  // the legacy single-dir settings so "remove all rows" really falls back to
  // the env var / hardcoded default the help text promises, instead of a
  // stale claude_log_dir silently winning the fallback chain.
  setSetting('claude_log_dir', '');
  setSetting('codex_log_dir', '');

  if (changed) {
    // Clearing the ingest cache forces the next scan to re-read every file and
    // re-stamp source_tag, so renaming a tag or moving a path re-tags existing
    // sessions (otherwise the mtime/size cache would skip unchanged files).
    getSqlite().prepare('DELETE FROM ingest_state').run();
  }
  revalidatePath('/settings');
  revalidatePath('/');
}

async function rescan() {
  'use server';
  await runIngest();
  revalidatePath('/');
  revalidatePath('/settings');
}

export default function SettingsPage() {
  const provider = (getSetting('llm_provider') as LlmProvider) || 'anthropic';
  const anthKey = getSetting('anthropic_api_key') || '';
  const oaiKey = getSetting('openai_api_key') || '';
  const classifierModel = getSetting('classifier_model') || defaultModel(provider);
  const summarizerModel = getSetting('summarizer_model') || defaultModel(provider);
  // Default-on. The setting only stores 'off' when the user explicitly
  // opts out — any other state (unset, 'on', anything else) means auto.
  const autoClassify = getSetting('auto_classify') !== 'off';

  // Seed the form from the RAW saved config, not the resolved sources — the
  // resolved list bakes the env-var/legacy fallback into an explicit row, so
  // one Save would freeze e.g. AGENTGRAPHED_CLAUDE_DIR's current value into
  // settings and silently ignore later env changes. The effective fallback is
  // shown as the placeholder instead.
  const claudeSources = parseSourceRows(getSetting('claude_sources'));
  const codexSources = parseSourceRows(getSetting('codex_sources'));
  const claudePlaceholder = fallbackPath('claude');
  const codexPlaceholder = fallbackPath('codex');

  const stats = getSqlite()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN category IS NOT NULL THEN 1 ELSE 0 END) AS classified
       FROM sessions WHERE first_prompt IS NOT NULL`,
    )
    .get() as { total: number; classified: number };

  return (
    <div>
      <PageHeader title="Settings" />

      <div className="p-7 space-y-6 max-w-3xl">
        <LlmSection
          provider={provider}
          anthKey={anthKey}
          oaiKey={oaiKey}
          classifierModel={classifierModel}
          summarizerModel={summarizerModel}
          classified={stats.classified}
          total={stats.total}
          autoClassify={autoClassify}
        />

        <div className="card">
          <div className="card-header">Data sources</div>
          <form action={savePaths} className="p-5 space-y-4 text-body-md text-ink-dim">
            <SourceList
              name="claude_sources"
              label="Claude Code log directories"
              initial={claudeSources}
              placeholder={claudePlaceholder}
            />
            <SourceList
              name="codex_sources"
              label="Codex CLI log directories"
              initial={codexSources}
              placeholder={codexPlaceholder}
            />
            <div className="flex items-center gap-2">
              <button className="btn btn-primary" type="submit">Save paths</button>
            </div>
            <p className="text-body-sm text-ink-mute">
              Add one row per log directory. The tag labels each source in the
              timeline and sessions views. Remove all rows to fall back to the
              default directory (shown as placeholder), tagged{' '}
              <span className="font-mono">default</span>. Changes apply after
              the next scan — click &quot;Re-scan logs now&quot; to apply them
              immediately.
            </p>
          </form>
          <div className="px-5 pb-5 border-t border-surface-2 pt-4">
            <form action={rescan}>
              <button className="btn" type="submit">Re-scan logs now</button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span>Leaderboard</span>
            <span className="normal-case tracking-normal font-normal text-ink-mute text-[11px]">
              opt-in · off by default
            </span>
          </div>
          <div className="p-5 text-body-sm text-ink-dim leading-relaxed">
            Compare your weekly stats with other AgentGraphed users. Nothing leaves your
            machine unless you explicitly opt in — and even then only aggregated stats
            (tokens, sessions, cost, model mix). No prompts, no project names, no
            session content.{' '}
            <a href="/leaderboard" className="text-primary hover:underline">
              See exactly what gets sent →
            </a>
          </div>
        </div>

        <div className="text-[11px] text-ink-mute font-mono space-y-0.5 px-1">
          <div>
            <span className="mr-2">data folder:</span>
            <span className="text-ink-dim">{dataDir()}</span>
          </div>
          <div>
            <span className="mr-2">prices last updated:</span>
            <span className="text-ink-dim">{PRICES_LAST_UPDATED}</span>
            <span className="ml-2">— retail list prices, treat as directional</span>
          </div>
        </div>
      </div>
    </div>
  );
}
