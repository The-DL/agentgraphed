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

  // We show billing-mix shares by DOLLAR, not by token count. Anthropic's
  // cache_read rate is ~10% of fresh input, so a 99% cache_read share in
  // tokens shrinks to ~94% in dollars — a more honest visual because it
  // matches what you actually paid. Token shares are surfaced as numeric
  // hover text only.
  const billedCost = Math.max(
    0.0001,
    summary.input_cost_usd + summary.cache_write_cost_usd + summary.cache_read_cost_usd + summary.output_cost_usd,
  );
  const inDollarPct = (summary.input_cost_usd / billedCost) * 100;
  const cwDollarPct = (summary.cache_write_cost_usd / billedCost) * 100;
  const crDollarPct = (summary.cache_read_cost_usd / billedCost) * 100;
  const outDollarPct = (summary.output_cost_usd / billedCost) * 100;

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

        {/* Billing mix — dollar shares, not token shares */}
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[11px] text-ink-mute uppercase tracking-wider">
              What your dollars paid for
            </span>
            <span className="text-[11px] text-ink-mute font-mono">by est. cost · not by token count</span>
          </div>
          <div className="flex h-3 rounded overflow-hidden mb-2" title="Bar widths are dollar shares, not token counts.">
            <Bar pct={inDollarPct} color="#ff5e94" title={`Fresh input — $${summary.input_cost_usd.toFixed(2)} (${inDollarPct.toFixed(1)}%)`} />
            <Bar pct={cwDollarPct} color="#ffaa3a" title={`Cache writes — $${summary.cache_write_cost_usd.toFixed(2)} (${cwDollarPct.toFixed(1)}%)`} />
            <Bar pct={crDollarPct} color="#5cd0ff" title={`Replayed context — $${summary.cache_read_cost_usd.toFixed(2)} (${crDollarPct.toFixed(1)}%)`} />
            <Bar pct={outDollarPct} color="#00ffab" title={`Output (Claude's replies + tool calls) — $${summary.output_cost_usd.toFixed(2)} (${outDollarPct.toFixed(1)}%)`} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] font-mono">
            <DollarStat
              color="#ff5e94"
              label="Fresh input"
              dollars={summary.input_cost_usd}
              dollarPct={inDollarPct}
              tokens={summary.input_tokens}
              tooltip="Your new prompts + uncached context, charged at the full input rate."
            />
            <DollarStat
              color="#ffaa3a"
              label="Cache writes"
              dollars={summary.cache_write_cost_usd}
              dollarPct={cwDollarPct}
              tokens={summary.cache_write_tokens}
              tooltip="Content being written into Anthropic's prompt cache (~1.25× input rate). Pays back when subsequent turns re-read the same content."
            />
            <DollarStat
              color="#5cd0ff"
              label="Replayed context"
              dollars={summary.cache_read_cost_usd}
              dollarPct={crDollarPct}
              tokens={summary.cache_read_tokens}
              tooltip="Conversation context already in cache, re-billed every turn at the ~10% rate. This is usually big on long Claude Code sessions — it's the cheap regime, not a problem."
            />
            <DollarStat
              color="#00ffab"
              label="Output"
              dollars={summary.output_cost_usd}
              dollarPct={outDollarPct}
              tokens={summary.output_tokens}
              tooltip="Claude's text replies + tool calls, charged at the full output rate (highest per-token)."
            />
          </div>
          <p className="mt-3 text-[11px] text-ink-mute leading-relaxed">
            <strong className="text-ink-dim">Why &ldquo;Replayed context&rdquo; usually dominates:</strong>{' '}
            Anthropic re-bills the entire conversation context every turn. Cache reads cost
            ~10% of fresh input, but they stack up across long sessions. A 90%+ replay share
            here is the <em>cheap</em> regime — you&apos;d be paying ~10× more without prompt
            caching. The lever you can move is the <span className="text-ink-dim">Fresh input</span> share,
            which grows when context can&apos;t be cached (new system prompts, model swaps,
            very fresh tool results).
          </p>
        </div>

        {/* Sources */}
        <div>
          <div className="text-[11px] text-ink-mute uppercase tracking-wider mb-3">
            What put content into Claude&apos;s context
            <span className="ml-2 normal-case tracking-normal font-normal text-ink-mute">
              (pro-rated cost by source — input-side bytes are re-billed every turn until they age out of cache)
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SourceList
              title="What Claude read"
              subtitle={`${fmtCost(inCost)} · input-side`}
              hint="Tool results + your prompts. Bytes here become part of Claude's input context and re-bill on every subsequent turn."
              rows={inputRows}
              expanded={inputExpanded}
              onToggle={() => setExpandedSide(inputExpanded ? 'none' : (outputExpanded ? 'output' : 'input'))}
              accent="primary"
            />
            <SourceList
              title="What Claude said"
              subtitle={`${fmtCost(outCost)} · output-side`}
              hint="Claude's text replies + the JSON arguments of every tool call it made."
              rows={outputRows}
              expanded={outputExpanded}
              onToggle={() => setExpandedSide(outputExpanded ? (inputExpanded ? 'input' : 'none') : (inputExpanded ? 'both' : 'output'))}
              accent="secondary"
            />
          </div>
        </div>

        {/* Honest footer */}
        <div className="text-[11px] text-ink-mute border-t border-surface-2 pt-3 space-y-1 leading-relaxed">
          <p>
            <strong className="text-ink-dim">Two different views, same dollars.</strong>{' '}
            The top bar shows what billing kind your dollars went to (fresh input vs cache).
            The bottom rows show what content source those dollars came from (Read tool, Bash,
            your prompts, etc.). Every dollar appears in <em>both</em> views — they&apos;re
            different cross-sections of the same cost.
          </p>
          <p>
            <strong className="text-ink-dim">&ldquo;Read&rdquo; means the Read tool</strong> —
            files Claude pulled into context — not the &ldquo;Replayed context&rdquo; billing
            kind. They&apos;re unrelated despite sharing a word. The Read tool&apos;s dollar
            value is a pro-rated estimate of how much of your bill came from file contents
            staying in Claude&apos;s context window.
          </p>
          <p>
            Per-source <span className="font-mono">$</span> figures are pro-rated: we take
            each session&apos;s actual <span className="font-mono">est_cost_usd</span> and
            split it across content items by share of unique bytes. We can&apos;t observe which
            individual reads landed in fresh input vs cache, so the split assumes each byte of
            a kind paid the same average rate. Headline cost is exact; source split is an
            honest estimate.
          </p>
        </div>
      </div>
    </div>
  );
}

function Bar({ pct, color, title }: { pct: number; color: string; title?: string }) {
  if (pct < 0.5) return null;
  return <div style={{ width: `${pct}%`, backgroundColor: color }} title={title} />;
}

function DollarStat({
  color,
  label,
  dollars,
  dollarPct,
  tokens,
  tooltip,
}: {
  color: string;
  label: string;
  dollars: number;
  dollarPct: number;
  tokens: number;
  tooltip: string;
}) {
  return (
    <div className="flex items-start gap-2 text-ink-mute" title={tooltip}>
      <span className="inline-block w-2 h-2 rounded-sm flex-shrink-0 mt-1.5" style={{ backgroundColor: color }} />
      <div className="leading-tight">
        <div className="text-ink-dim">{label}</div>
        <div className="text-ink">{fmtCost(dollars)} <span className="text-ink-mute">({dollarPct.toFixed(0)}%)</span></div>
        <div className="text-ink-mute text-[10px]">{fmtTokens(tokens)} tokens</div>
      </div>
    </div>
  );
}

function SourceList({
  title, subtitle, hint, rows, expanded, onToggle, accent,
}: {
  title: string;
  subtitle: string;
  hint?: string;
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
        <span className="text-body-md text-ink" title={hint}>{title}</span>
        <span className="text-[11px] text-ink-mute font-mono normal-case tracking-normal">{subtitle}</span>
      </div>
      {hint && (
        <div className="text-[11px] text-ink-mute leading-relaxed mb-3 -mt-1">{hint}</div>
      )}
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
          const rowTip =
            r.kind === 'tool_result'
              ? `Bytes returned by the ${r.source ?? 'unknown'} tool, fed into Claude's input context. Pro-rated cost across input-side billing buckets (fresh + cache_read + cache_write).`
              : r.kind === 'tool_use'
              ? `JSON arguments Claude sent when calling the ${r.source ?? 'unknown'} tool. Billed as output tokens (highest per-token rate).`
              : r.kind === 'user_text'
              ? 'Your prompts. Fed into Claude’s input context and re-billed every subsequent turn (mostly at cache rate).'
              : 'Claude’s text replies. Billed as output tokens.';
          return (
            <div key={`${r.kind}|${r.source ?? ''}`} className="space-y-1" title={rowTip}>
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
