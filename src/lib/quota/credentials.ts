// Read Claude Code's OAuth credentials.
//
// Claude Code stores its bearer + refresh tokens at ~/.claude/.credentials.json.
// We read them so we can probe api.anthropic.com on the user's behalf without
// making them paste their own API key. Same approach as Clawdmeter.
//
// Security: this file is mode 0600 on disk (owner-only). We never log it,
// never send it anywhere except api.anthropic.com over TLS, and never persist
// it elsewhere — quota_snapshots stores only the derived percentages.

import { readFile, writeFile, stat, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json');

export type ClaudeCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;            // ms epoch
  subscriptionType: string | null;
  rateLimitTier: string | null;
};

export type CredentialsResult =
  | { ok: true; creds: ClaudeCredentials; warning?: string }
  | { ok: false; error: string };

export async function readClaudeCredentials(): Promise<CredentialsResult> {
  let raw: string;
  try {
    raw = await readFile(CREDENTIALS_PATH, 'utf8');
  } catch (e) {
    const msg = (e as NodeJS.ErrnoException).code === 'ENOENT'
      ? 'Claude Code credentials not found. Sign into Claude Code first.'
      : `Could not read credentials: ${(e as Error).message}`;
    return { ok: false, error: msg };
  }

  let parsed: { claudeAiOauth?: Partial<ClaudeCredentials> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'credentials.json is not valid JSON' };
  }

  const oauth = parsed.claudeAiOauth;
  if (!oauth?.accessToken || !oauth.refreshToken || !oauth.expiresAt) {
    return { ok: false, error: 'credentials.json is missing claudeAiOauth fields' };
  }

  // Warn (but don't block) if the file isn't owner-only — surfaces misconfigured installs.
  let warning: string | undefined;
  try {
    const st = await stat(CREDENTIALS_PATH);
    const modeBits = st.mode & 0o777;
    if (modeBits !== 0o600 && process.platform !== 'win32') {
      warning = `~/.claude/.credentials.json has mode ${modeBits.toString(8)}; expected 600.`;
    }
  } catch {
    // ignore — we already have the contents
  }

  return {
    ok: true,
    creds: {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken,
      expiresAt: oauth.expiresAt,
      subscriptionType: oauth.subscriptionType ?? null,
      rateLimitTier: oauth.rateLimitTier ?? null,
    },
    warning,
  };
}

// Write refreshed tokens back, preserving 0600 permissions. Atomically by
// writing-then-renaming to avoid corrupting the file mid-write.
export async function writeClaudeCredentials(updated: ClaudeCredentials): Promise<void> {
  const raw = await readFile(CREDENTIALS_PATH, 'utf8');
  const parsed = JSON.parse(raw) as { claudeAiOauth?: Record<string, unknown> };
  const merged = {
    ...parsed,
    claudeAiOauth: {
      ...(parsed.claudeAiOauth ?? {}),
      accessToken: updated.accessToken,
      refreshToken: updated.refreshToken,
      expiresAt: updated.expiresAt,
    },
  };
  const next = JSON.stringify(merged, null, 2);
  const tmpPath = `${CREDENTIALS_PATH}.tmp-${Date.now()}`;
  await writeFile(tmpPath, next, { encoding: 'utf8', mode: 0o600 });
  await chmod(tmpPath, 0o600);
  // Rename is atomic on POSIX same-fs.
  const { rename } = await import('node:fs/promises');
  await rename(tmpPath, CREDENTIALS_PATH);
}
