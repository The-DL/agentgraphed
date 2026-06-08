// GET /api/share/session/<id> — generates a 1200x630 PNG stat card for a
// session, suitable for tweeting / posting. Branded with the AgentGraphed
// wordmark + agentgraphed.com so any share is also a tiny piece of
// distribution.
//
// Uses Next.js's built-in ImageResponse (powered by Satori). No external
// deps; everything inlined as flat JSX.

import { ImageResponse } from 'next/og';
import { getSession } from '@/lib/queries';
import { displayTitle } from '@/lib/sessionDisplay';
import { fmtTokens, fmtCost, fmtDuration } from '@/lib/format';

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

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = getSession(id);
  if (!s) {
    return new Response('Session not found', { status: 404 });
  }

  const title = truncate(displayTitle(s), 80);
  const tokens = s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens;
  const startedAt = new Date(s.started_at);
  const dateLabel = startedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          backgroundColor: BG,
          color: INK,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: 64,
          position: 'relative',
        }}
      >
        {/* Brand mark top-left. Avoid the ▮ glyph because Satori would try to
            fetch a remote font containing it and fail in offline / sandboxed
            runs. Render the mark as a plain CSS block instead. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 12, height: 28, backgroundColor: PRIMARY, borderRadius: 3, display: 'flex' }} />
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, display: 'flex' }}>
            <div style={{ display: 'flex', color: INK_DIM }}>Agent</div>
            <div style={{ display: 'flex', color: PRIMARY }}>Graphed</div>
          </div>
          <div style={{
            marginLeft: 14, color: INK_MUTE, fontSize: 13,
            letterSpacing: 1.5, textTransform: 'uppercase', display: 'flex',
          }}>Session</div>
        </div>

        {/* Title */}
        <div style={{
          marginTop: 56,
          fontSize: 60,
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: -1.5,
          color: INK,
          display: 'flex',
          maxWidth: W - 128,
        }}>
          {title}
        </div>

        {/* Subtitle row. Satori requires every multi-child container to be
            display: flex (or none); plain spans break it. Use divs instead. */}
        <div style={{
          marginTop: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          color: INK_MUTE,
          fontSize: 22,
        }}>
          <div style={{ display: 'flex' }}>{s.project_name}</div>
          <div style={{ display: 'flex' }}>·</div>
          <div style={{ display: 'flex', fontFamily: 'monospace' }}>{s.model || 'unknown'}</div>
          <div style={{ display: 'flex' }}>·</div>
          <div style={{ display: 'flex' }}>{dateLabel}</div>
        </div>

        {/* Stats row */}
        <div style={{
          marginTop: 'auto',
          display: 'flex',
          gap: 16,
        }}>
          <Stat label="Tokens"   value={fmtTokens(tokens)}            accent={PRIMARY} />
          <Stat label="Duration" value={fmtDuration(s.duration_ms)} />
          <Stat label="Messages" value={`${s.user_message_count}`} />
          <Stat label="Est. Cost" value={fmtCost(s.est_cost_usd)}     accent={SECONDARY} />
        </div>

        {/* Footer */}
        <div style={{
          marginTop: 24,
          display: 'flex',
          color: INK_MUTE,
          fontSize: 18,
          fontFamily: 'monospace',
        }}>
          agentgraphed.com
        </div>
      </div>
    ),
    { width: W, height: H },
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{
      flex: 1,
      backgroundColor: SURFACE,
      border: `1px solid ${SURFACE_BORDER}`,
      borderRadius: 8,
      padding: '20px 22px',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{
        color: INK_MUTE,
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        display: 'flex',
      }}>{label}</div>
      <div style={{
        marginTop: 6,
        fontSize: 36,
        fontWeight: 500,
        color: accent || INK,
        fontFamily: 'monospace',
        display: 'flex',
      }}>{value}</div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}
