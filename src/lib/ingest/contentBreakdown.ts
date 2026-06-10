// Walks a Claude Code JSONL `message.content` array (or string) and yields
// one ToolIo entry per content item. The ingester writes these to the
// tool_io table; the session-detail page reads them back to show where the
// session's tokens went by source category.
//
// Honest framing the UI should mirror: we report *bytes* exactly (literal
// UTF-8 character count of each text payload) and *est. tokens* as
// `ceil(bytes / 4)`. The /4 estimate is rough but matches Anthropic's
// commonly-cited rule of thumb; the dashboard tooltip labels these as
// "≈ tokens" so nobody mistakes them for Anthropic's billed numbers.

export type ToolIoKind =
  | 'user_text'      // user-written prompt (input)
  | 'assistant_text' // Claude's text reply (output)
  | 'tool_use'       // Claude calling a tool (output, just the call site)
  | 'tool_result';   // Tool response coming back (input next turn)

export type ToolIo = {
  kind: ToolIoKind;
  source: string | null; // tool name for tool_use / tool_result; null otherwise
  bytes: number;
  est_tokens: number;
};

// Anthropic + many tokenizer libraries converge on "≈ 4 chars per token" as
// a defensible rule of thumb for English/code. Real cost still floats per
// model and per content type — we wear the "≈" badge in the UI to be honest.
const CHARS_PER_TOKEN = 4;
function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / CHARS_PER_TOKEN);
}

// Sum the text-bearing parts of an arbitrary content payload.
// Used for tool_result inner content (which is sometimes a string, sometimes
// a list of {type:'text', text:...} or an image-result placeholder).
function payloadBytes(payload: unknown): number {
  if (typeof payload === 'string') return Buffer.byteLength(payload, 'utf8');
  if (Array.isArray(payload)) {
    let n = 0;
    for (const p of payload) {
      if (typeof p === 'string') {
        n += Buffer.byteLength(p, 'utf8');
        continue;
      }
      if (p && typeof p === 'object') {
        const o = p as { type?: string; text?: string };
        if (typeof o.text === 'string') n += Buffer.byteLength(o.text, 'utf8');
      }
    }
    return n;
  }
  return 0;
}

// Given a parsed Claude JSONL line's `message.role` and `message.content`,
// emit one ToolIo per content item we care about. We DROP nothing implicitly
// (no skipped types) so the caller can sum to a total that matches the
// message's billed token count for sanity-checking.
export function extractToolIo(role: string | undefined, content: unknown): ToolIo[] {
  const out: ToolIo[] = [];

  // String shorthand: the entire message is plain text.
  if (typeof content === 'string') {
    const bytes = Buffer.byteLength(content, 'utf8');
    out.push({
      kind: role === 'assistant' ? 'assistant_text' : 'user_text',
      source: null,
      bytes,
      est_tokens: estimateTokens(bytes),
    });
    return out;
  }

  if (!Array.isArray(content)) return out;

  for (const item of content) {
    if (typeof item === 'string') {
      const bytes = Buffer.byteLength(item, 'utf8');
      out.push({
        kind: role === 'assistant' ? 'assistant_text' : 'user_text',
        source: null,
        bytes,
        est_tokens: estimateTokens(bytes),
      });
      continue;
    }
    if (!item || typeof item !== 'object') continue;

    const o = item as {
      type?: string;
      text?: string;
      name?: string;
      input?: unknown;
      content?: unknown;
      tool_use_id?: string;
    };

    switch (o.type) {
      case 'text': {
        const text = typeof o.text === 'string' ? o.text : '';
        const bytes = Buffer.byteLength(text, 'utf8');
        out.push({
          kind: role === 'assistant' ? 'assistant_text' : 'user_text',
          source: null,
          bytes,
          est_tokens: estimateTokens(bytes),
        });
        break;
      }
      case 'tool_use': {
        // Bytes here = the JSON-serialized tool input (the arguments Claude
        // passed). The tool's name appears in `name`. MCP tools come through
        // as `mcp__<server>__<tool>` — we keep the full name and let the UI
        // decide how to group.
        const args = o.input == null ? '' : JSON.stringify(o.input);
        const bytes = Buffer.byteLength(args, 'utf8');
        out.push({
          kind: 'tool_use',
          source: typeof o.name === 'string' ? o.name : null,
          bytes,
          est_tokens: estimateTokens(bytes),
        });
        break;
      }
      case 'tool_result': {
        // Tool result content is the response body that gets fed back into
        // Claude's next input window. We don't have the tool *name* on the
        // result item itself — only the `tool_use_id` linking back to the
        // earlier tool_use. The ingester will resolve this in a second pass.
        const bytes = payloadBytes(o.content);
        out.push({
          kind: 'tool_result',
          source: typeof o.tool_use_id === 'string' ? o.tool_use_id : null,
          bytes,
          est_tokens: estimateTokens(bytes),
        });
        break;
      }
      // Anything else (thinking blocks, redacted content, server-tool calls
      // we don't recognize, etc.) we deliberately skip — better to undercount
      // honestly than guess at a kind.
    }
  }

  return out;
}

// Roll a flat ToolIo list up into a single shape per (kind, source) pair
// the UI can render. Resolves tool_result.source from tool_use_id when the
// caller passes in a tool_use_id → name lookup.
export type ToolIoSummary = {
  kind: ToolIoKind;
  source: string | null;
  bytes: number;
  est_tokens: number;
  count: number; // how many content items rolled into this row
};

export function summarizeToolIo(
  rows: Array<ToolIo & { tool_use_id?: string }>,
  toolNameByUseId: Map<string, string>,
): ToolIoSummary[] {
  const acc = new Map<string, ToolIoSummary>();
  for (const r of rows) {
    let source = r.source;
    // Resolve tool_result's tool_use_id back to the original tool name.
    if (r.kind === 'tool_result' && source && toolNameByUseId.has(source)) {
      source = toolNameByUseId.get(source)!;
    }
    const key = `${r.kind}|${source ?? ''}`;
    const cur = acc.get(key);
    if (cur) {
      cur.bytes += r.bytes;
      cur.est_tokens += r.est_tokens;
      cur.count += 1;
    } else {
      acc.set(key, {
        kind: r.kind,
        source,
        bytes: r.bytes,
        est_tokens: r.est_tokens,
        count: 1,
      });
    }
  }
  return [...acc.values()].sort((a, b) => b.est_tokens - a.est_tokens);
}
