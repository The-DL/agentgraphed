'use client';

import { useState } from 'react';
import { fmtTokens, fmtCost } from '@/lib/format';
import type { TokenBreakdownSummary, TokenBreakdownRow } from '@/lib/queries';
import { ShareButton } from './ShareButton';

// Full "where your cost went" view for the Analytics page. Same data as
// the dashboard chart toggle but expanded:
//   1. Headline: dollar cost in window + billed-tokens-vs-unique-content
//      mismatch (cache replay multiplier).
//   2. Billing mix: fresh input / cache creation / cache read / output
//      shares of billed tokens — the real cost-shaping levers.
//   3. Per-source table split into INPUT-side (tool_result + user_text)
//      and OUTPUT-side (tool_use + assistant_text). Each row shows the
//      source, the pro-rated dollar attribution, the unique bytes that
//      flowed, and an item count. Top 5 by default; expand to see all.
//   4. Honest footer that explains the pro-rating and the cache caveat.
//
// Client component because we own the expand/collapse + the share-image
// trigger; the data still arrives prefetched from the server page.

type Props = {
  summary: TokenBreakdownSummary;
  rangeLabel: string;
  // The `days` value that produced this summary. We pass it to the share
  // image URL so the PNG renders the same window the user is looking at.
  days: number | null;
};

const TOP_DEFAULT = 5;

function displaySource(source: string | null, kind: string): string {
  if (kind === 'user_text') return 'Your prompts';
  if (kind === 'assistant_text') return "Claude's text replies";
  if (!source) return '(unknown)';
  if (source.startsWith('mcp__')) {
    const parts = source.slice(5).split('__');
    if (parts.length >= 2) return `MCP · ${parts[0]} · ${parts.slice(1).join('__')}`;
    return `MCP · ${parts.join('__')}`;
  }
  return source;
}

export function TokenBreakdownDetailCard({ summary, rangeLabel, days }: Props) {
  const [expandedSide, setExpandedSide] = useState<'none' | 'input' | 'output' | 'both'>('none');

  if (summary.rows.length === 0) return null;

  const inputRows = summary.rows.filter((r) => r.kind === 'tool_result' || r.kind === 'user_text');
  const outputRows = summary.rows.filter((r) => r.kind === 'tool_use' || r.kind === 'assistant_text');

  const inCost = inputRows.reduce((s, r) => s + r.est_cost_usd, 0);
  const outCost = outputRows.reduce((s, r) => s + r.est_cost_usd, 0);

  const billed = Math.max(1, summary.billed_tokens);
  const inPct = (summary.input_tokens / billed) * 100;
  const cwPct = (summary.cache_write_tokens / billed) * 100;
  const crPct = (summary.cache_read_tokens / billed) * 100;
  const outPct = (summary.output_tokens / billed) * 100;

  const cacheMultiplier =
    summary.unique_bytes > 0
      ? (summary.input_tokens + summary.cache_read_tokens + summary.cache_write_tokens) /
        (summary.unique_bytes / 4)
      : 0;

  const shareUrl = `/api/share/cost-breakdown?days=${days === null ? 'all' : days}`;

  const inputExpanded = expandedSide === 'input' || expandedSide === 'both';
  const outputExpanded = expandedSide === 'output' || expandedSide === 'both';

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <span>Where your cost went · {rangeLabel}</span>
        <div className="flex items-center gap-2 normal-case tracking-normal">
          <span className="text-ink-mute text-[11px]">pro-rated estimates · see footer</span>
          <ShareButton imageUrl={shareUrl} />
        </div>
      </div>

      <div className="p-5 space-y-6">
        {/* Headline */}
        <div>
          <div className="flex items-baseline gap-4 mb-1">
            <span className="text-headline-md font-semibold text-secondary tabular">
              {fmtCost(summary.total_cost_usd)}
            </span>
            <span className="text-body-md text-ink-mute">in this range</span>
          </div>
          <div className="text-body-sm text-ink-mute font-mono">
            <span className="text-ink-dim">{fmtTokens(summary.billed_tokens)}</span> billed tokens
            <span className="mx-2">·</span>
            <span className="text-ink-dim">{fmtBytes(summary.unique_bytes)}</span> of unique content fed in
            {cacheMultiplier > 2 && (
              <>
                <span className="mx-2">·</span>
                <span className="text-ink-dim">{cacheMultiplier.toFixed(0)}×</span> cache reuse
              </>
            )}
          </div>
        </div>

        {/* Billing mix */}
        <div>
          <div className="text-[11px] text-ink-mute uppercase tracking-wider mb-2">Billing mix</div>
          <div className="flex h-3 rounded overflow-hidden mb-2">
            <Bar pct={inPct} color="#ff5e94" />
            <Bar pct={cwPct} color="#ffaa3a" />
            <Bar pct={crPct} color="#5cd0ff" />
            <Bar pct={outPct} color="#00ffab" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] font-mono">
            <BillStat color="#ff5e94" label="fresh input" tokens={summary.input_tokens} pct={inPct} />
            <BillStat color="#ffaa3a" label="cache creation" tokens={summary.cache_write_tokens} pct={cwPct} />
            <BillStat color="#5cd0ff" label="cache read (cheap)" tokens={summary.cache_read_tokens} pct={crPct} />
            <BillStat color="#00ffab" label="output" tokens={summary.output_tokens} pct={outPct} />
          </div>
        </div>

        {/* Sources */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <SourceList
            title="What Claude read"
            subtitle={`${fmtCost(inCost)} · input-side`}
            rows={inputRows}
            expanded={inputExpanded}
            onToggle={() => setExpandedSide(inputExpanded ? 'none' : (outputExpanded ? 'output' : 'input'))}
            accent="primary"
          />
          <SourceList
            title="What Claude said"
            subtitle={`${fmtCost(outCost)} · output-side`}
            rows={outputRows}
            expanded={outputExpanded}
            onToggle={() => setExpandedSide(outputExpanded ? (inputExpanded ? 'input' : 'none') : (inputExpanded ? 'both' : 'output'))}
            accent="secondary"
          />
        </div>

        {/* Honest footer */}
        <div className="text-[11px] text-ink-mute border-t border-surface-2 pt-3 space-y-1 leading-relaxed">
          <p>
            Per-source <span className="text-ink-dim">$</span> figures are pro-rated:
            we take the session&apos;s actual <span className="font-mono">est_cost_usd</span> and
            split it across content items by their share of unique bytes. Input-side cost is
            split among tool results + your prompts; output-side cost is split among tool calls
            + Claude&apos;s text.
          </p>
          <p>
            We can&apos;t observe which individual reads landed in fresh input vs cache,
            so the per-source split assumes each byte of a kind paid the same average rate.
            That means a Read whose contents got cached is undercredited and a Read that
            arrived fresh is overcredited. The headline cost is exact; the source split is
            an honest estimate.
          </p>
        </div>
      </div>
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  if (pct < 0.5) return null;
  return <div style={{ width: `${pct}%`, backgroundColor: color }} />;
}

function BillStat({ color, label, tokens, pct }: { color: string; label: string; tokens: number; pct: number }) {
  return (
    <div className="flex items-center gap-2 text-ink-mute">
      <span className="inline-block w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="truncate">
        <span className="text-ink-dim">{label}</span>
        <span className="ml-1">{pct.toFixed(0)}%</span>
        <span className="ml-1 text-ink-mute">({fmtTokens(tokens)})</span>
      </span>
    </div>
  );
}

function SourceList({
  title, subtitle, rows, expanded, onToggle, accent,
}: {
  title: string;
  subtitle: string;
  rows: TokenBreakdownRow[];
  expanded: boolean;
  onToggle: () => void;
  accent: 'primary' | 'secondary';
}) {
  const visible = expanded ? rows : rows.slice(0, TOP_DEFAULT);
  const hidden = Math.max(0, rows.length - TOP_DEFAULT);
  const maxCost = Math.max(...rows.map((r) => r.est_cost_usd), 0.0001);
  const barClass = accent === 'primary' ? 'bg-primary/70' : 'bg-secondary/70';

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-body-md text-ink">{title}</span>
        <span className="text-[11px] text-ink-mute font-mono normal-case tracking-normal">{subtitle}</span>
      </div>
      <div className="space-y-2">
        {visible.length === 0 && (
          <div className="text-body-sm text-ink-mute">No data in this group.</div>
        )}
        {visible.map((r) => {
          const label =
            r.kind === 'user_text' ? 'Your prompts'
            : r.kind === 'assistant_text' ? "Claude's text replies"
            : (() => {
                const src = r.source;
                if (!src) return '(unknown)';
                if (src.startsWith('mcp__')) {
                  const parts = src.slice(5).split('__');
                  if (parts.length >= 2) return `MCP · ${parts[0]} · ${parts.slice(1).join('__')}`;
                  return `MCP · ${parts.join('__')}`;
                }
                return src;
              })()
            + (r.kind === 'tool_use' ? ' · call args' : '');
          const detail = `${r.items} ${r.items === 1 ? 'item' : 'items'} · ${fmtBytes(r.bytes)}`;
          const pct = (r.est_cost_usd / maxCost) * 100;
          return (
            <div key={`${r.kind}|${r.source ?? ''}`} className="space-y-1">
              <div className="flex items-baseline justify-between text-body-sm">
                <span className="text-ink-dim truncate pr-2">
                  {label}
                  <span className="text-ink-mute font-mono text-[11px] ml-2">{detail}</span>
                </span>
                <span className="font-mono text-ink tabular text-code-sm whitespace-nowrap">
                  ≈{fmtCost(r.est_cost_usd)}
                </span>
              </div>
              <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
                <div className={`h-full ${barClass}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            </div>
          );
        })}
        {hidden > 0 && (
          <button
            type="button"
            onClick={onToggle}
            className="text-[11px] text-ink-mute hover:text-primary font-mono normal-case tracking-normal pt-1"
          >
            {expanded ? '▴ show top 5' : `▾ show ${hidden} more`}
          </button>
        )}
      </div>
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(1)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${n} B`;
}
