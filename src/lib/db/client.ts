import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { dbPath } from './paths';
import * as schema from './schema';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _sqlite: Database.Database | null = null;

export function getDb() {
  if (_db) return _db;
  _sqlite = new Database(dbPath());
  _sqlite.pragma('journal_mode = WAL');
  _sqlite.pragma('synchronous = NORMAL');
  ensureSchema(_sqlite);
  _db = drizzle(_sqlite, { schema });
  return _db;
}

export function getSqlite(): Database.Database {
  if (!_sqlite) getDb();
  return _sqlite!;
}

function ensureSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      git_remote TEXT,
      first_seen INTEGER NOT NULL,
      last_active INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS projects_root_idx ON projects(root_path);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      project_id TEXT NOT NULL,
      cwd TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      model TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      user_message_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      est_cost_usd REAL NOT NULL DEFAULT 0,
      first_prompt TEXT,
      summary TEXT,
      summary_generated INTEGER NOT NULL DEFAULT 0,
      heuristic_title TEXT,
      category TEXT,
      keywords TEXT,
      git_branch TEXT,
      source_path TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_project_idx ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS sessions_started_idx ON sessions(started_at);
    CREATE INDEX IF NOT EXISTS sessions_provider_idx ON sessions(provider);
    CREATE INDEX IF NOT EXISTS sessions_model_idx ON sessions(model);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      model TEXT
    );
    CREATE INDEX IF NOT EXISTS messages_session_idx ON messages(session_id);
    CREATE INDEX IF NOT EXISTS messages_timestamp_idx ON messages(timestamp);

    CREATE TABLE IF NOT EXISTS ingest_state (
      source_path TEXT PRIMARY KEY,
      mtime INTEGER NOT NULL,
      size INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      ingested_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS day_summaries (
      day TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      generated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_summaries (
      project_id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      generated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_contexts (
      session_id TEXT PRIMARY KEY,
      context TEXT NOT NULL,
      generated_at INTEGER NOT NULL,
      model TEXT
    );

    CREATE TABLE IF NOT EXISTS quota_snapshots (
      provider TEXT PRIMARY KEY,
      observed_at INTEGER NOT NULL,
      plan_type TEXT,
      primary_pct REAL,
      primary_window_minutes INTEGER,
      primary_resets_at INTEGER,
      secondary_pct REAL,
      secondary_window_minutes INTEGER,
      secondary_resets_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS claude_limit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      observed_at INTEGER NOT NULL,
      reset_at INTEGER,
      kind TEXT NOT NULL,
      raw TEXT
    );
    CREATE INDEX IF NOT EXISTS claude_limit_events_observed_idx ON claude_limit_events(observed_at);
    CREATE INDEX IF NOT EXISTS claude_limit_events_session_idx ON claude_limit_events(session_id);
  `);

  // Lightweight migrations for existing DBs from earlier versions.
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has('heuristic_title')) db.exec('ALTER TABLE sessions ADD COLUMN heuristic_title TEXT');
  if (!colNames.has('category')) db.exec('ALTER TABLE sessions ADD COLUMN category TEXT');
  if (!colNames.has('keywords')) db.exec('ALTER TABLE sessions ADD COLUMN keywords TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS sessions_category_idx ON sessions(category)');

  // categories: JSON array of labels. Backfill from the single-string `category`
  // column so existing classifications survive the migration.
  if (!colNames.has('categories')) {
    db.exec('ALTER TABLE sessions ADD COLUMN categories TEXT');
    db.exec(`UPDATE sessions
             SET categories = json_array(category)
             WHERE category IS NOT NULL AND categories IS NULL`);
  }

  // Per-message token columns. Older DBs only stored token totals on
  // sessions, which made multi-day sessions impossible to attribute to the
  // day the work actually happened on. Backfilling requires a re-scan of the
  // source JSONL files — see ingest_state invalidation below.
  const msgCols = db.prepare('PRAGMA table_info(messages)').all() as { name: string }[];
  const msgColNames = new Set(msgCols.map((c) => c.name));
  if (!msgColNames.has('input_tokens')) db.exec('ALTER TABLE messages ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0');
  if (!msgColNames.has('output_tokens')) db.exec('ALTER TABLE messages ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0');
  if (!msgColNames.has('cache_read_tokens')) db.exec('ALTER TABLE messages ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0');
  if (!msgColNames.has('cache_write_tokens')) db.exec('ALTER TABLE messages ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0');
  if (!msgColNames.has('est_cost_usd')) db.exec('ALTER TABLE messages ADD COLUMN est_cost_usd REAL NOT NULL DEFAULT 0');

  // Schema-version-driven re-ingest. When SCHEMA_VERSION bumps, we drop
  // ingest_state so every file gets re-read on the next scan. Cheap: the
  // ingesters already idempotently upsert sessions + messages by id, so a
  // re-ingest just refreshes the per-message token columns we just added.
  // Bump this when message ingestion semantics change so existing rows get
  // rebuilt on next boot from the source JSONLs. v2 added per-message token
  // columns; v3 fixes the multi-file Claude session collision where subagent
  // files were wiping the parent transcript's messages.
  const SCHEMA_VERSION = '3';
  const prev = db.prepare('SELECT value FROM settings WHERE key = ?').get('schema_version') as
    | { value: string }
    | undefined;
  if (prev?.value !== SCHEMA_VERSION) {
    db.exec('DELETE FROM ingest_state');
    db.exec('DELETE FROM messages');
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
      'schema_version',
      SCHEMA_VERSION,
    );
  }

  // After the migration + re-ingest, some sessions will have message rows
  // with zero tokens because their source JSONL files were rotated off disk
  // by Claude Code. Those sessions still have correct totals on the sessions
  // row, so we prorate session totals across their message rows weighted by
  // assistant-message timestamp. Cheap, idempotent, and only touches rows
  // that ended up at zero. Runs every boot — if a session re-ingest later
  // populates real per-message tokens, this is a no-op for it.
  backfillProratedMessageTokens(db);
}

// Reconcile message-level token totals against the session row's totals.
// When messages.SUM < sessions.row (the common case for sessions whose source
// JSONL files have been rotated off disk, OR for ingests that only saw a
// subagent file), distribute the missing tokens across the assistant messages
// we DO have, weighted evenly by message. Keeps historical dashboard totals
// honest without lying about per-day attribution: messages still sit on their
// real timestamps. Cheap, idempotent, and a no-op once message-level data is
// complete (messages.SUM == sessions.row).
function backfillProratedMessageTokens(db: Database.Database): void {
  // Sessions with zero message rows at all — usually because the source JSONL
  // is gone from disk. Seed a single synthetic placeholder message at
  // started_at carrying the session total so the session shows up on the
  // dashboard's date-windowed queries. The placeholder has empty content;
  // it's not surfaced in the conversation view (we filter by content there).
  const orphans = db
    .prepare(
      `SELECT s.id, s.started_at, s.model,
              s.input_tokens, s.output_tokens, s.cache_read_tokens, s.cache_write_tokens, s.est_cost_usd
       FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
       WHERE m.id IS NULL
         AND (s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens) > 0
       GROUP BY s.id`,
    )
    .all() as Array<{
      id: string; started_at: number; model: string | null;
      input_tokens: number; output_tokens: number;
      cache_read_tokens: number; cache_write_tokens: number;
      est_cost_usd: number;
    }>;
  if (orphans.length > 0) {
    const insert = db.prepare(
      `INSERT INTO messages (
         id, session_id, role, content, timestamp, model,
         input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, est_cost_usd
       ) VALUES (?, ?, 'assistant', '', ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = db.transaction(() => {
      for (const o of orphans) {
        insert.run(
          `${o.id}-orphan`, o.id, o.started_at, o.model,
          o.input_tokens, o.output_tokens, o.cache_read_tokens, o.cache_write_tokens, o.est_cost_usd,
        );
      }
    });
    tx();
  }

  const gaps = db
    .prepare(
      `SELECT s.id,
              s.input_tokens AS s_in, s.output_tokens AS s_out,
              s.cache_read_tokens AS s_cr, s.cache_write_tokens AS s_cw,
              s.est_cost_usd AS s_cost,
              COALESCE(SUM(m.input_tokens), 0) AS m_in,
              COALESCE(SUM(m.output_tokens), 0) AS m_out,
              COALESCE(SUM(m.cache_read_tokens), 0) AS m_cr,
              COALESCE(SUM(m.cache_write_tokens), 0) AS m_cw,
              COALESCE(SUM(m.est_cost_usd), 0) AS m_cost,
              COUNT(CASE WHEN m.role = 'assistant' THEN 1 END) AS asst_count
       FROM sessions s LEFT JOIN messages m ON m.session_id = s.id
       GROUP BY s.id
       HAVING ((s_in + s_out + s_cr + s_cw) > (m_in + m_out + m_cr + m_cw)
               OR s_cost > m_cost + 0.001)
          AND asst_count > 0`,
    )
    .all() as Array<{
      id: string;
      s_in: number; s_out: number; s_cr: number; s_cw: number; s_cost: number;
      m_in: number; m_out: number; m_cr: number; m_cw: number; m_cost: number;
      asst_count: number;
    }>;

  if (gaps.length === 0) return;

  const getAssistantMsgs = db.prepare(
    `SELECT id FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY timestamp`,
  );
  const bumpMsg = db.prepare(
    `UPDATE messages SET
       input_tokens = input_tokens + ?,
       output_tokens = output_tokens + ?,
       cache_read_tokens = cache_read_tokens + ?,
       cache_write_tokens = cache_write_tokens + ?,
       est_cost_usd = est_cost_usd + ?
     WHERE id = ?`,
  );

  const tx = db.transaction(() => {
    for (const g of gaps) {
      const msgs = getAssistantMsgs.all(g.id) as { id: string }[];
      if (msgs.length === 0) continue;
      const n = msgs.length;
      const missIn = Math.max(0, g.s_in - g.m_in);
      const missOut = Math.max(0, g.s_out - g.m_out);
      const missCr = Math.max(0, g.s_cr - g.m_cr);
      const missCw = Math.max(0, g.s_cw - g.m_cw);
      const missCost = Math.max(0, g.s_cost - g.m_cost);
      const perIn = Math.floor(missIn / n);
      const perOut = Math.floor(missOut / n);
      const perCr = Math.floor(missCr / n);
      const perCw = Math.floor(missCw / n);
      const perCost = missCost / n;
      const remIn = missIn - perIn * n;
      const remOut = missOut - perOut * n;
      const remCr = missCr - perCr * n;
      const remCw = missCw - perCw * n;
      for (let i = 0; i < n; i++) {
        const isLast = i === n - 1;
        bumpMsg.run(
          perIn + (isLast ? remIn : 0),
          perOut + (isLast ? remOut : 0),
          perCr + (isLast ? remCr : 0),
          perCw + (isLast ? remCw : 0),
          perCost,
          msgs[i].id,
        );
      }
    }
  });
  tx();
}
