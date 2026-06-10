// GET /api/share/cost-breakdown?days=7|30|90|all
// — generates a 1200x630 PNG of the "Where your cost went" breakdown,
// matching the on-page card (analytics view) but rendered as a static
// social-card image. Uses the same pro-rated cost attribution as the page.

import { ImageResponse } from 'next/og';
import { getTokenBreakdown } from '@/lib/queries';
import { fmtCost, fmtTokens } from '@/lib/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const W = 1200;
const H = 630;
const BG = '#10141a';
const SURFACE = '#181c22';
const SURFACE_BORDER = '#262a31';
const INK = '#dfe2eb';
const INK_DIM = '#b9caca';
const INK_MUTE = '#849495';
const PRIMARY = '#00f5ff';
const SECONDARY = '#00ffab';

const COL_FRESH = '#ff5e94';
const COL_CACHE_W = '#ffaa3a';
const COL_CACHE_R = '#5cd0ff';
const COL_OUTPUT = '#00ffab';

function rangeLabel(days: number | null): string {
  if (days === null) return 'all-time';
  if (days === 1) return 'last 24h';
  if (days === 7) return 'last 7 days';
  if (days === 30) return 'last 30 days';
  if (days === 90) return 'last 90 days';
  return `last ${days} days`;
}

function displaySource(source: string | null, kind: string): string {
  if (kind === 'user_text') return 'Your prompts';
  if (kind === 'assistant_text') return "Claude's text";
  if (!source) return 'unknown';
  if (source.startsWith('mcp__')) {
    const parts = source.slice(5).split('__');
    if (parts.length >= 2) return `MCP · ${parts[0]} · ${parts.slice(1).join('__')}`;
    return `MCP · ${parts.join('__')}`;
  }
  if (kind === 'tool_use') return `${source} · call`;
  return source;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get('days') ?? '30';
  const days: number | null = raw === 'all' ? null : Math.max(1, parseInt(raw, 10) || 30);

  const summary = getTokenBreakdown(days);

  // Dollar shares — see TokenBreakdownDetailCard for the rationale. Token
  // shares make cache_read look like 99% of everything; dollar shares give
  // a much more honest visual.
  const billedCost = Math.max(
    0.0001,
    summary.input_cost_usd + summary.cache_write_cost_usd + summary.cache_read_cost_usd + summary.output_cost_usd,
  );
  const inPct = (summary.input_cost_usd / billedCost) * 100;
  const cwPct = (summary.cache_write_cost_usd / billedCost) * 100;
  const crPct = (summary.cache_read_cost_usd / billedCost) * 100;
  const outPct = (summary.output_cost_usd / billedCost) * 100;

  const inputRows = summary.rows.filter((r) => r.kind === 'tool_result' || r.kind === 'user_text');
  const outputRows = summary.rows.filter((r) => r.kind === 'tool_use' || r.kind === 'assistant_text');
  const TOP_PER_COLUMN = 6;
  const topInput = inputRows.slice(0, TOP_PER_COLUMN);
  const topOutput = outputRows.slice(0, TOP_PER_COLUMN);
  const inCostTotal = inputRows.reduce((s, r) => s + r.est_cost_usd, 0);
  const outCostTotal = outputRows.reduce((s, r) => s + r.est_cost_usd, 0);

  return new ImageResponse(
    (
      <div
        style={{
          width: W, height: H, backgroundColor: BG, color: INK,
          display: 'flex', flexDirection: 'column',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: 56,
        }}
      >
        {/* Brand bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 12, height: 28, backgroundColor: PRIMARY, borderRadius: 3, display: 'flex' }} />
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, display: 'flex' }}>
            <div style={{ display: 'flex', color: INK_DIM }}>Agent</div>
            <div style={{ display: 'flex', color: PRIMARY }}>Graphed</div>
          </div>
          <div style={{
            marginLeft: 14, color: INK_MUTE, fontSize: 13, letterSpacing: 1.5,
            textTransform: 'uppercase', display: 'flex',
          }}>Where my cost went · {rangeLabel(days)}</div>
        </div>

        {/* Headline */}
        <div style={{ marginTop: 28, display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <div style={{
            fontSize: 56, fontWeight: 600, color: SECONDARY,
            fontFamily: 'monospace', letterSpacing: -1, display: 'flex',
          }}>{fmtCost(summary.total_cost_usd)}</div>
          <div style={{ display: 'flex', color: INK_MUTE, fontSize: 16, fontFamily: 'monospace' }}>
            {fmtTokens(summary.billed_tokens)} billed tokens
          </div>
        </div>

        {/* Billing mix bar */}
        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            display: 'flex', color: INK_MUTE, fontSize: 11, letterSpacing: 1.2,
            textTransform: 'uppercase', marginBottom: 6,
          }}>What your dollars paid for</div>
          <div style={{ display: 'flex', height: 12, borderRadius: 4, overflow: 'hidden' }}>
            {inPct >= 0.5 && <div style={{ width: `${inPct}%`, backgroundColor: COL_FRESH, display: 'flex' }} />}
            {cwPct >= 0.5 && <div style={{ width: `${cwPct}%`, backgroundColor: COL_CACHE_W, display: 'flex' }} />}
            {crPct >= 0.5 && <div style={{ width: `${crPct}%`, backgroundColor: COL_CACHE_R, display: 'flex' }} />}
            {outPct >= 0.5 && <div style={{ width: `${outPct}%`, backgroundColor: COL_OUTPUT, display: 'flex' }} />}
          </div>
          <div style={{
            display: 'flex', marginTop: 6, gap: 18, color: INK_MUTE,
            fontSize: 12, fontFamily: 'monospace',
          }}>
            {inPct >= 0.5 && <MixLabel color={COL_FRESH} label="fresh input" pct={inPct} />}
            {cwPct >= 0.5 && <MixLabel color={COL_CACHE_W} label="cache writes" pct={cwPct} />}
            {crPct >= 0.5 && <MixLabel color={COL_CACHE_R} label="replayed context" pct={crPct} />}
            {outPct >= 0.5 && <MixLabel color={COL_OUTPUT} label="output" pct={outPct} />}
          </div>
        </div>

        {/* Two-column source breakdown */}
        <div style={{
          marginTop: 22, flex: 1, display: 'flex', gap: 18,
        }}>
          <SourceColumn
            title="What Claude read"
            subtitle={`${fmtCost(inCostTotal)} · input-side`}
            rows={topInput.map((r) => ({
              label: displaySource(r.source, r.kind),
              cost: r.est_cost_usd,
              maxCost: Math.max(...topInput.map((x) => x.est_cost_usd), 0.0001),
            }))}
            accent={PRIMARY}
          />
          <SourceColumn
            title="What Claude said"
            subtitle={`${fmtCost(outCostTotal)} · output-side`}
            rows={topOutput.map((r) => ({
              label: displaySource(r.source, r.kind),
              cost: r.est_cost_usd,
              maxCost: Math.max(...topOutput.map((x) => x.est_cost_usd), 0.0001),
            }))}
            accent={SECONDARY}
          />
        </div>

        {/* Footer */}
        <div style={{
          marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          color: INK_MUTE, fontSize: 14, fontFamily: 'monospace',
        }}>
          <div style={{ display: 'flex', color: INK_DIM }}>Pro-rated from per-session billing · est. only.</div>
          <div style={{ display: 'flex' }}>agentgraphed.com</div>
        </div>
      </div>
    ),
    { width: W, height: H },
  );
}

function MixLabel({ color, label, pct }: { color: string; label: string; pct: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color, display: 'flex' }} />
      <div style={{ display: 'flex', color: INK_DIM }}>{label}</div>
      <div style={{ display: 'flex' }}>{pct.toFixed(0)}%</div>
    </div>
  );
}

function SourceColumn({
  title, subtitle, rows, accent,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ label: string; cost: number; maxCost: number }>;
  accent: string;
}) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      backgroundColor: SURFACE, border: `1px solid ${SURFACE_BORDER}`,
      borderRadius: 8, padding: '14px 18px',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
        marginBottom: 12,
      }}>
        <div style={{ display: 'flex', color: INK, fontSize: 16, fontWeight: 600 }}>{title}</div>
        <div style={{ display: 'flex', color: INK_MUTE, fontSize: 11, fontFamily: 'monospace' }}>{subtitle}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
        {rows.map((r, i) => {
          const pct = (r.cost / r.maxCost) * 100;
          return (
            <div key={`${r.label}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{
                  display: 'flex', color: INK_DIM, fontSize: 13,
                  maxWidth: '70%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                }}>{r.label}</div>
                <div style={{ display: 'flex', color: INK, fontSize: 13, fontFamily: 'monospace' }}>
                  {fmtCost(r.cost)}
                </div>
              </div>
              <div style={{ display: 'flex', height: 3, backgroundColor: '#1c2026', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  display: 'flex', width: `${Math.min(100, pct)}%`,
                  backgroundColor: accent, opacity: 0.7,
                }} />
              </div>
            </div>
          );
        })}
        {rows.length === 0 && (
          <div style={{ display: 'flex', color: INK_MUTE, fontSize: 13 }}>No data.</div>
        )}
      </div>
    </div>
  );
}
