import { PageHeader } from '@/components/PageHeader';
import { LeaderboardOptIn } from '@/components/LeaderboardOptIn';
import { getSetting, getSessionsForLeaderboard, getRangeSummary } from '@/lib/queries';
import { fmtCost, fmtTokens } from '@/lib/format';

export const dynamic = 'force-dynamic';

// What this page is for:
//   - Local: explain the leaderboard concept, show the user *exactly* what
//     would be sent, let them opt in (or out). Once opted in, the page
//     shows last-submission status and links to the public rankings at
//     agentgraphed.com/leaderboard.
//
// Honest framing throughout: local-only by default, leaderboard is opt-in,
// and we show the literal payload that goes over the wire before asking.

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export default async function LeaderboardPage() {
  const optedIn = getSetting('leaderboard_opt_in') === 'on';
  const handle = getSetting('leaderboard_handle') || '';
  const lastSubmittedAt = parseInt(getSetting('leaderboard_last_submitted_ms') || '0', 10);

  // Compute the exact payload we would send right now. Same shape will be
  // POSTed by the client when opted in.
  const sessions = getSessionsForLeaderboard(Date.now() - LOOKBACK_MS);
  const week = getRangeSummary(7);
  const previewPayload = {
    handle: handle || '<your-handle>',
    schema_version: 2,
    sessions: sessions.slice(0, 3).map((s) => ({
      session_uuid: s.session_uuid,
      started_at: new Date(s.started_at).toISOString(),
      duration_ms: s.duration_ms,
      provider: s.provider,
      model: s.model,
      input_tokens: s.input_tokens,
      output_tokens: s.output_tokens,
      cache_read_tokens: s.cache_read_tokens,
      cache_write_tokens: s.cache_write_tokens,
      est_cost_usd: Math.round(s.est_cost_usd * 10000) / 10000,
      message_count: s.message_count,
    })),
  };

  return (
    <div>
      <PageHeader
        title="Leaderboard"
        subtitle="Optional · see how you stack up against other AgentGraphed users"
      />

      <div className="p-7 space-y-6 max-w-3xl">
        {/* What we send — shown FIRST, before opt-in */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span>What we send</span>
            <span className="normal-case tracking-normal font-normal text-ink-mute text-[11px]">
              this is the literal payload — nothing else
            </span>
          </div>
          <div className="p-5 space-y-3">
            <div className="text-body-sm text-ink-mute">
              Every six hours (or sooner if you finished a new session since the last
              submit), we&apos;d post one batch of session-level rows. Each row contains
              only what you see below. <span className="text-ink-dim">No prompts,
              no project names, no session content, no file paths, no cwd.</span>{' '}
              <a
                href="https://agentgraphed.com/privacy"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                Full privacy doc →
              </a>
            </div>
            <div className="text-[11px] text-ink-mute">
              Preview of your next submission ({sessions.length} session{sessions.length === 1 ? '' : 's'} in the
              last 7 days; showing first 3):
            </div>
            <pre className="bg-canvas border border-surface-3 rounded p-3 text-code-sm font-mono text-ink-dim overflow-x-auto">
{JSON.stringify(previewPayload, null, 2)}
            </pre>
            <div className="text-[11px] text-ink-mute leading-relaxed">
              <span className="text-ink-dim">Identity</span> is just the handle you choose
              (anonymous, no email needed). A future release will add an optional GitHub
              claim so you can rank under your real handle if you want — but anonymous
              handles will keep working.
            </div>
          </div>
        </div>

        {/* Status / opt-in */}
        <div className="card">
          <div className="card-header flex items-center justify-between">
            <span>Status</span>
            <span className="normal-case tracking-normal font-normal text-ink-mute text-[11px]">
              local-first by default
            </span>
          </div>
          <div className="p-5">
            {optedIn ? (
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-secondary text-body-md font-medium">
                      Submitting as{' '}
                      <a
                        href={`https://agentgraphed.com/u/${encodeURIComponent(handle)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono hover:underline"
                      >
                        {handle || '(no handle set)'}
                      </a>
                    </div>
                    <div className="text-[11px] text-ink-mute mt-1">
                      {lastSubmittedAt
                        ? `Last submission ${new Date(lastSubmittedAt).toLocaleString()}`
                        : 'No submission yet — will run on the next dashboard render.'}
                    </div>
                  </div>
                </div>
                <div className="text-body-sm text-ink-mute leading-relaxed">
                  Public rankings are live at{' '}
                  <a
                    href="https://agentgraphed.com/leaderboard"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    agentgraphed.com/leaderboard
                  </a>
                  . The submitter posts session stats roughly every six hours; if the
                  last submission timestamp above is recent, your profile is up to date.
                </div>
                <LeaderboardOptIn initialOptIn={optedIn} initialHandle={handle} />
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-body-md text-ink">
                    Opt in to share session-level stats with the public leaderboard.
                  </div>
                  <div className="text-body-sm text-ink-mute mt-1">
                    Local-first by default. Nothing leaves your machine until you flip
                    the switch. Even then we only send the fields shown above — never
                    prompts, project names, or session content.
                  </div>
                </div>
                <LeaderboardOptIn initialOptIn={optedIn} initialHandle={handle} />
              </div>
            )}
          </div>
        </div>

        {/* Audit / delete */}
        {handle && (
          <div className="card">
            <div className="card-header">Audit or delete your data</div>
            <div className="p-5 space-y-2 text-body-sm text-ink-mute leading-relaxed">
              <p>
                See exactly what the server has for your handle, or delete it. Anyone
                with your handle can do either (it&apos;s anonymous both ways) — by
                design.
              </p>
              <pre className="bg-canvas border border-surface-3 rounded p-3 text-code-sm font-mono text-ink-dim overflow-x-auto">
{`# See your data
curl 'https://agentgraphed.com/api/leaderboard/my-data?handle=${handle}'

# Delete your data
curl -X DELETE 'https://agentgraphed.com/api/leaderboard/my-data?handle=${handle}'`}
              </pre>
            </div>
          </div>
        )}

        {/* Headline stats preview */}
        <div className="grid grid-cols-4 gap-4">
          <Mini label="Tokens · 7d" value={fmtTokens(week.tokens)} />
          <Mini label="Sessions · 7d" value={week.sessions.toLocaleString()} />
          <Mini label="Projects · 7d" value={week.projects.toString()} />
          <Mini label="Est. Cost · 7d" value={fmtCost(week.cost)} accent="secondary" />
        </div>

        <div className="text-[11px] text-ink-mute leading-relaxed border-t border-surface-2 pt-3">
          The leaderboard endpoint{' '}
          <span className="font-mono">agentgraphed.com/api/leaderboard/submit</span>{' '}
          accepts the payload above. You can opt out any time — submissions stop
          immediately. We don&apos;t publish anything beyond this aggregate view.
        </div>
      </div>
    </div>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: 'secondary' }) {
  return (
    <div className="card">
      <div className="p-3">
        <div className="text-[10px] uppercase tracking-wider text-ink-mute mb-1">{label}</div>
        <div className={`text-headline-md font-mono ${accent === 'secondary' ? 'text-secondary' : 'text-ink'}`}>
          {value}
        </div>
      </div>
    </div>
  );
}
