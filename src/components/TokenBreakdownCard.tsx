import { fmtTokens } from '@/lib/format';
import type { SessionTokenBreakdownRow } from '@/lib/queries';

// "Where did this session's tokens come from?" card. Three honest framings
// driving the design:
//
//   1. We report estimated tokens (bytes / 4) — Anthropic doesn't publish a
//      per-content-item breakdown of billed tokens. The "≈" badge throughout
//      the UI signals this; the section header calls it out once explicitly.
//
//   2. We split into two top-level groupings: WHAT CLAUDE READ (input-side:
//      tool results + your prompts + history) vs WHAT CLAUDE SAID (output-side:
//      Claude's text + tool calls). Anthropic bills input + output at very
//      different rates, so combining them would mislead.
//
//   3. Within tool sources we strip the `mcp__` prefix and show the server +
//      tool name; everything else (Bash, Read, Edit, Write, Grep, Glob,
//      WebFetch, WebSearch, etc.) is the raw tool name.

type Props = {
  rows: SessionTokenBreakdownRow[];
};

function displaySource(source: string | null): string {
  if (!source) return '(unknown)';
  if (source.startsWith('mcp__')) {
    // mcp__<server>__<tool>  →  "<server> · <tool>"
    const parts = source.slice(5).split('__');
    if (parts.length >= 2) return `MCP · ${parts[0]} · ${parts.slice(1).join('__')}`;
    return `MCP · ${parts.join('__')}`;
  }
  return source;
}

export function TokenBreakdownCard({ rows }: Props) {
  if (rows.length === 0) return null;

  const toolResults = rows.filter((r) => r.kind === 'tool_result');
  const toolCalls = rows.filter((r) => r.kind === 'tool_use');
  const assistantText = rows.find((r) => r.kind === 'assistant_text');
  const userText = rows.find((r) => r.kind === 'user_text');

  const inputBytes = sum(toolResults, 'bytes') + (userText?.bytes ?? 0);
  const inputTokens = sum(toolResults, 'est_tokens') + (userText?.est_tokens ?? 0);
  const outputBytes = sum(toolCalls, 'bytes') + (assistantText?.bytes ?? 0);
  const outputTokens = sum(toolCalls, 'est_tokens') + (assistantText?.est_tokens ?? 0);
  const totalTokens = Math.max(1, inputTokens + outputTokens);

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <span>Where the tokens came from</span>
        <span className="normal-case tracking-normal font-normal text-ink-mute text-[11px]">
          ≈ estimated from content size, not Anthropic billing
        </span>
      </div>
      <div className="p-4 space-y-5">
        <Section
          title="What Claude read"
          subtitle="counts toward input tokens"
          totalLabel={`${fmtTokens(inputTokens)} · ${fmtBytes(inputBytes)}`}
          totalPct={(inputTokens / totalTokens) * 100}
          accent="primary"
        >
          {toolResults.length === 0 && !userText && (
            <Row label="No input-side breakdown captured." />
          )}
          {userText && userText.est_tokens > 0 && (
            <Row
              label="Your prompts"
              detail={`${userText.items} ${userText.items === 1 ? 'message' : 'messages'}`}
              tokens={userText.est_tokens}
              bytes={userText.bytes}
              pct={(userText.est_tokens / Math.max(inputTokens, 1)) * 100}
              accent="primary"
            />
          )}
          {toolResults.map((r) => (
            <Row
              key={`r-${r.source}`}
              label={displaySource(r.source)}
              detail={`${r.items} ${r.items === 1 ? 'result' : 'results'}`}
              tokens={r.est_tokens}
              bytes={r.bytes}
              pct={(r.est_tokens / Math.max(inputTokens, 1)) * 100}
              accent="primary"
            />
          ))}
        </Section>

        <Section
          title="What Claude said"
          subtitle="counts toward output tokens"
          totalLabel={`${fmtTokens(outputTokens)} · ${fmtBytes(outputBytes)}`}
          totalPct={(outputTokens / totalTokens) * 100}
          accent="secondary"
        >
          {assistantText && assistantText.est_tokens > 0 && (
            <Row
              label="Claude's text replies"
              detail={`${assistantText.items} ${assistantText.items === 1 ? 'reply' : 'replies'}`}
              tokens={assistantText.est_tokens}
              bytes={assistantText.bytes}
              pct={(assistantText.est_tokens / Math.max(outputTokens, 1)) * 100}
              accent="secondary"
            />
          )}
          {toolCalls.map((r) => (
            <Row
              key={`u-${r.source}`}
              label={`${displaySource(r.source)} ${'·'} call args`}
              detail={`${r.items} ${r.items === 1 ? 'call' : 'calls'}`}
              tokens={r.est_tokens}
              bytes={r.bytes}
              pct={(r.est_tokens / Math.max(outputTokens, 1)) * 100}
              accent="secondary"
            />
          ))}
          {toolCalls.length === 0 && !assistantText && (
            <Row label="No output-side breakdown captured." />
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  totalLabel,
  totalPct,
  accent,
  children,
}: {
  title: string;
  subtitle: string;
  totalLabel: string;
  totalPct: number;
  accent: 'primary' | 'secondary';
  children: React.ReactNode;
}) {
  const accentColor = accent === 'primary' ? 'text-primary' : 'text-secondary';
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <span className="text-body-md text-ink">{title}</span>
          <span className="text-[11px] text-ink-mute ml-2">{subtitle}</span>
        </div>
        <div className="text-code-sm font-mono tabular text-ink-dim">
          <span className={accentColor}>{totalLabel}</span>
          <span className="text-ink-mute ml-2">{totalPct.toFixed(0)}% of session</span>
        </div>
      </div>
      <div className="space-y-1.5 pl-1">{children}</div>
    </div>
  );
}

function Row({
  label,
  detail,
  tokens,
  bytes,
  pct,
  accent,
}: {
  label: string;
  detail?: string;
  tokens?: number;
  bytes?: number;
  pct?: number;
  accent?: 'primary' | 'secondary';
}) {
  const barColor = accent === 'secondary' ? 'bg-secondary/70' : 'bg-primary/70';
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-body-sm">
        <span className="text-ink-dim truncate pr-2">
          {label}
          {detail && <span className="text-ink-mute font-mono text-[11px] ml-2">{detail}</span>}
        </span>
        {tokens !== undefined && (
          <span className="font-mono text-ink-mute tabular text-code-sm whitespace-nowrap">
            ≈{fmtTokens(tokens)}
            {bytes !== undefined && <span className="text-ink-mute"> · {fmtBytes(bytes)}</span>}
            {pct !== undefined && <span className="text-ink-mute"> · {pct.toFixed(0)}%</span>}
          </span>
        )}
      </div>
      {pct !== undefined && (
        <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
          <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${n} B`;
}

function sum<T extends { [k in K]: number }, K extends string>(rows: T[], key: K): number {
  return rows.reduce((acc, r) => acc + r[key], 0);
}
