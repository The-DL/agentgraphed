'use client';

import { useState } from 'react';
import { fmtTokens, fmtCost } from '@/lib/format';
import type { TokenBreakdownSummary, TokenBreakdownRow } from '@/lib/queries';
import { ShareButton } from './ShareButton';
import { Tooltip } from './Tooltip';

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
              tip={
                <>
                  <p className="mb-2"><strong className="text-ink">Fresh input</strong> is content Claude saw <em>for the first time</em> — your new prompts, plus any context that wasn&apos;t already in Anthropic&apos;s prompt cache.</p>
                  <p className="mb-2">Billed at the <strong>full input rate</strong>, the most expensive way to feed in context.</p>
                  <p>This is the lever you can move. It grows when context can&apos;t be cached — new system prompts, model swaps, very fresh tool results. A low share here means you&apos;re benefiting from prompt caching.</p>
                </>
              }
            />
            <DollarStat
              color="#ffaa3a"
              label="Cache writes"
              dollars={summary.cache_write_cost_usd}
              dollarPct={cwDollarPct}
              tokens={summary.cache_write_tokens}
              tip={
                <>
                  <p className="mb-2"><strong className="text-ink">Cache writes</strong> are tokens Anthropic is <em>storing</em> in the prompt cache so future turns can re-use them cheaply.</p>
                  <p className="mb-2">Billed at <strong>~1.25× the fresh input rate</strong> — a small premium for the storage. Pays back the first time a subsequent turn re-reads the same content.</p>
                  <p>You&apos;ll see a small share here whenever long-lived context first enters cache.</p>
                </>
              }
            />
            <DollarStat
              color="#5cd0ff"
              label="Replayed context"
              dollars={summary.cache_read_cost_usd}
              dollarPct={crDollarPct}
              tokens={summary.cache_read_tokens}
              tip={
                <>
                  <p className="mb-2"><strong className="text-ink">Replayed context</strong> is conversation history already in Anthropic&apos;s prompt cache, being re-charged on every subsequent turn.</p>
                  <p className="mb-2">Billed at <strong>~10% of the fresh input rate</strong> — the cheap regime.</p>
                  <p className="mb-2"><strong>Why this usually dominates:</strong> Anthropic re-bills the full conversation context every turn. Cache reads are 10× cheaper per token but they stack up across long sessions. A 90%+ share here is <em>good</em> — without prompt caching, you&apos;d be paying roughly 10× this number at the fresh-input rate.</p>
                  <p>The lever to reduce it: shorter sessions with less accumulated context. The lever to <em>improve</em> it: stable system prompts and tool patterns, which let Anthropic keep more of the cache warm.</p>
                </>
              }
            />
            <DollarStat
              color="#00ffab"
              label="Output"
              dollars={summary.output_cost_usd}
              dollarPct={outDollarPct}
              tokens={summary.output_tokens}
              tip={
                <>
                  <p className="mb-2"><strong className="text-ink">Output</strong> is everything Claude generated — text replies plus the JSON arguments of every tool call it made.</p>
                  <p>Billed at the <strong>full output rate</strong>, which is the highest per-token price (typically ~5× input). Low volume but expensive per token; even a small token share here can mean a notable dollar share.</p>
                </>
              }
            />
          </div>
        </div>

        {/* Sources */}
        <div>
          <div className="text-[11px] text-ink-mute uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <span>What put content into Claude&apos;s context</span>
            <Tooltip width={360}>
              <p className="mb-2">These rows show <strong>where the bytes Claude saw came from</strong>, with each session&apos;s actual cost split across them by share of unique bytes.</p>
              <p className="mb-2"><strong className="text-ink">Same dollars as the top bar</strong>, different cross-section: the top bar splits cost by billing kind (fresh / cache write / replayed / output); these rows split the same total by content source.</p>
              <p>So a row like &ldquo;Read · $7,682&rdquo; means: of all the dollars you paid for content going into Claude&apos;s context, roughly $7,682 worth came from file contents the Read tool put there. We can&apos;t observe which individual bytes hit cache vs fresh — Anthropic only reports the totals per session.</p>
            </Tooltip>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SourceList
              title="What Claude read"
              subtitle={`${fmtCost(inCost)} · input-side`}
              headerTip={
                <>
                  <p className="mb-2"><strong className="text-ink">What Claude read</strong> = input-side content. Tool results (file contents Read pulled in, Bash output, MCP responses, etc.) plus your own prompts.</p>
                  <p>Every byte here entered Claude&apos;s input context and was re-billed on every subsequent turn (mostly at the cheap cache-read rate, sometimes at fresh-input rate the first time, sometimes at cache-write rate the first time it got cached).</p>
                </>
              }
              rows={inputRows}
              expanded={inputExpanded}
              onToggle={() => setExpandedSide(inputExpanded ? 'none' : (outputExpanded ? 'output' : 'input'))}
              accent="primary"
            />
            <SourceList
              title="What Claude said"
              subtitle={`${fmtCost(outCost)} · output-side`}
              headerTip={
                <>
                  <p className="mb-2"><strong className="text-ink">What Claude said</strong> = output-side content. Claude&apos;s text replies + the JSON arguments of every tool call it made (e.g. the file path and edit string for an Edit call).</p>
                  <p>Output tokens are billed at the highest per-token rate, so even a small share by volume can be a real share of cost.</p>
                </>
              }
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
  tip,
}: {
  color: string;
  label: string;
  dollars: number;
  dollarPct: number;
  tokens: number;
  tip: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 text-ink-mute">
      <span className="inline-block w-2 h-2 rounded-sm flex-shrink-0 mt-1.5" style={{ backgroundColor: color }} />
      <div className="leading-tight">
        <div className="text-ink-dim flex items-center gap-1.5">
          <span>{label}</span>
          <Tooltip width={340}>{tip}</Tooltip>
        </div>
        <div className="text-ink">{fmtCost(dollars)} <span className="text-ink-mute">({dollarPct.toFixed(0)}%)</span></div>
        <div className="text-ink-mute text-[10px]">{fmtTokens(tokens)} tokens</div>
      </div>
    </div>
  );
}

function SourceList({
  title, subtitle, headerTip, rows, expanded, onToggle, accent,
}: {
  title: string;
  subtitle: string;
  headerTip?: React.ReactNode;
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
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-body-md text-ink flex items-center gap-1.5">
          {title}
          {headerTip && <Tooltip width={340}>{headerTip}</Tooltip>}
        </span>
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
          const rowTip = sourceRowTip(r);
          return (
            <div key={`${r.kind}|${r.source ?? ''}`} className="space-y-1">
              <div className="flex items-baseline justify-between text-body-sm">
                <span className="text-ink-dim truncate pr-2 flex items-center gap-1.5">
                  <span className="truncate">{label}</span>
                  <Tooltip width={340}>{rowTip}</Tooltip>
                  <span className="text-ink-mute font-mono text-[11px] ml-1">{detail}</span>
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

// Per-row tooltip content. We special-case the popular Claude Code tools
// so the explanation is concrete ("Read tool = file contents") instead of
// generic. Falls back to a kind-based explanation otherwise.
function sourceRowTip(r: TokenBreakdownRow): React.ReactNode {
  // The most important disambiguation in the whole UI — the Read TOOL is not
  // the cache_read billing kind. Spell this out every time.
  if (r.kind === 'tool_result' && r.source === 'Read') {
    return (
      <>
        <p className="mb-2"><strong className="text-ink">Read</strong> here means the <strong>Read tool</strong> — file contents Claude pulled into its context window with <code className="font-mono text-[10px]">Read(file_path=…)</code>.</p>
        <p className="mb-2">This is <strong>not</strong> the same as &ldquo;cache read&rdquo; in the top bar. That&apos;s a billing rate. This is a content source.</p>
        <p>The dollar value is a pro-rated estimate of how much of your bill came from file contents staying in Claude&apos;s context across the window — paid at a mix of fresh-input, cache-write, and cache-read rates that we can&apos;t split per byte.</p>
      </>
    );
  }
  if (r.kind === 'tool_result' && r.source === 'Bash') {
    return (
      <>
        <p className="mb-2"><strong className="text-ink">Bash tool results</strong> = stdout/stderr Claude saw from shell commands it ran.</p>
        <p>Often surprisingly expensive because command output (logs, build errors, dumps) tends to be verbose and gets re-read every turn until it ages out of cache.</p>
      </>
    );
  }
  if (r.kind === 'tool_result' && (r.source === 'Edit' || r.source === 'Write')) {
    return (
      <>
        <p className="mb-2"><strong className="text-ink">{r.source} tool results</strong> = confirmation messages Claude received after editing or writing a file.</p>
        <p>Usually small per call — the file contents went out in the <em>call args</em>, not the result. The opposite shape from Read.</p>
      </>
    );
  }
  if (r.kind === 'tool_result' && r.source && r.source.startsWith('mcp__')) {
    const parts = r.source.slice(5).split('__');
    return (
      <>
        <p className="mb-2"><strong className="text-ink">MCP tool result</strong> from server <span className="font-mono">{parts[0]}</span>, tool <span className="font-mono">{parts.slice(1).join('__')}</span>.</p>
        <p>The response payload Claude received and added to its input context.</p>
      </>
    );
  }
  if (r.kind === 'tool_result') {
    return (
      <>
        <p className="mb-2"><strong className="text-ink">{r.source ?? 'Unknown'} tool result</strong> — content the tool returned to Claude.</p>
        <p>Each byte here entered Claude&apos;s input context and was re-billed on every subsequent turn (at a mix of fresh-input and cache rates).</p>
      </>
    );
  }
  if (r.kind === 'tool_use') {
    return (
      <>
        <p className="mb-2"><strong className="text-ink">{r.source ?? 'Unknown'} call args</strong> — the JSON arguments Claude sent when calling this tool.</p>
        <p>Billed as <strong>output tokens</strong> (the highest per-token rate). Edit and Write calls are usually the priciest here because the new file contents go in the args.</p>
      </>
    );
  }
  if (r.kind === 'user_text') {
    return (
      <>
        <p className="mb-2"><strong className="text-ink">Your prompts</strong> — the messages you typed into Claude Code.</p>
        <p>Fed into Claude&apos;s input context and re-billed every subsequent turn (mostly at the cheap cache-read rate after the first turn).</p>
      </>
    );
  }
  return (
    <>
      <p className="mb-2"><strong className="text-ink">Claude&apos;s text replies</strong> — everything Claude wrote back as plain text (not tool calls).</p>
      <p>Billed as <strong>output tokens</strong>. Lower volume than tool args but high per-token cost.</p>
    </>
  );
}
