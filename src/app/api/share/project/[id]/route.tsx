// GET /api/share/project/<id> — generates a 1200x630 PNG stat card for a
// project, suitable for tweeting / posting. Branded with agentgraphed.com.

import { ImageResponse } from 'next/og';
import { homedir } from 'node:os';
import { getProject, getSessionsForProject } from '@/lib/queries';
import { fmtTokens, fmtCost, fmtRelative } from '@/lib/format';
import { normalizeModelName } from '@/lib/pricing';

// Replace the user's home directory with ~ so a shared image doesn't broadcast
// their macOS username. /Users/mike/devProjects/foo → ~/devProjects/foo
function tildeify(path: string): string {
  const home = homedir();
  if (path.startsWith(home)) return '~' + path.slice(home.length);
  // Generic fallback: collapse the username after /Users/ or /home/
  return path.replace(/^(\/Users|\/home)\/[^/]+/, (m) => m.split('/').slice(0, 2).join('/') + '/~');
}

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
  const p = getProject(id);
  if (!p) return new Response('Project not found', { status: 404 });

  const sessions = getSessionsForProject(id, 500);
  // Top model used in this project (collapsed by family)
  const modelCounts = new Map<string, number>();
  for (const s of sessions) {
    const k = normalizeModelName(s.model || 'unknown');
    modelCounts.set(k, (modelCounts.get(k) || 0) + 1);
  }
  const topModel = [...modelCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'mixed';

  return new ImageResponse(
    (
      <div
        style={{
          width: W, height: H, backgroundColor: BG, color: INK,
          display: 'flex', flexDirection: 'column',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: 64,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 12, height: 28, backgroundColor: PRIMARY, borderRadius: 3, display: 'flex' }} />
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5, display: 'flex' }}>
            <div style={{ display: 'flex', color: INK_DIM }}>Agent</div>
            <div style={{ display: 'flex', color: PRIMARY }}>Graphed</div>
          </div>
          <div style={{
            marginLeft: 14, color: INK_MUTE, fontSize: 13, letterSpacing: 1.5,
            textTransform: 'uppercase', display: 'flex',
          }}>Project</div>
        </div>

        <div style={{
          marginTop: 56, fontSize: 64, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2,
          color: INK, display: 'flex',
        }}>
          {p.name}
        </div>

        <div style={{
          marginTop: 14, display: 'flex', alignItems: 'center', gap: 14,
          color: INK_MUTE, fontSize: 20,
        }}>
          <div style={{ display: 'flex', fontFamily: 'monospace' }}>{truncate(tildeify(p.root_path), 70)}</div>
        </div>

        <div style={{ marginTop: 'auto', display: 'flex', gap: 16 }}>
          <Stat label="Sessions"    value={p.sessions.toString()}            accent={PRIMARY} />
          <Stat label="Tokens"      value={fmtTokens(p.tokens)} />
          <Stat label="Est. Cost"   value={fmtCost(p.cost)}                  accent={SECONDARY} />
          <Stat label="Last Active" value={fmtRelative(p.last_active)} />
        </div>

        <div style={{
          marginTop: 22, display: 'flex', justifyContent: 'space-between',
          color: INK_MUTE, fontSize: 17, fontFamily: 'monospace',
        }}>
          <div style={{ display: 'flex' }}>{topModel !== 'mixed' ? `mostly ${topModel}` : 'multiple models'}</div>
          <div style={{ display: 'flex' }}>agentgraphed.com</div>
        </div>
      </div>
    ),
    { width: W, height: H },
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{
      flex: 1, backgroundColor: SURFACE, border: `1px solid ${SURFACE_BORDER}`,
      borderRadius: 8, padding: '20px 22px', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        color: INK_MUTE, fontSize: 13, fontWeight: 600, letterSpacing: 1.2,
        textTransform: 'uppercase', display: 'flex',
      }}>{label}</div>
      <div style={{
        marginTop: 6, fontSize: 36, fontWeight: 500,
        color: accent || INK, fontFamily: 'monospace', display: 'flex',
      }}>{value}</div>
    </div>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}
