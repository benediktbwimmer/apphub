import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type TagKV = {
  key: string;
  value: string;
  source?: string;
};

export type RepositoryRecord = {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  dockerfilePath: string;
  updatedAt: string;
  ingestStatus: IngestStatus;
  lastIngestedAt: string | null;
  createdAt: string;
  ingestError: string | null;
  ingestAttempts: number;
  tags: TagKV[];
};

export type IngestStatus = 'seed' | 'pending' | 'processing' | 'ready' | 'failed';

export type RepositoryInsert = {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  dockerfilePath: string;
  ingestStatus?: IngestStatus;
  lastIngestedAt?: string | null;
  updatedAt?: string;
  ingestError?: string | null;
  ingestAttempts?: number;
  tags?: (TagKV & { source?: string })[];
};

export type RepositorySearchParams = {
  text?: string;
  tags?: TagKV[];
};

export type IngestionEvent = {
  id: number;
  repositoryId: string;
  status: IngestStatus;
  message: string | null;
  attempt: number | null;
  commitSha: string | null;
  durationMs: number | null;
  createdAt: string;
};

export type TagSuggestion = {
  type: 'key' | 'pair';
  value: string;
  label: string;
};

const DEFAULT_DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'catalog.db');

const dbPath = process.env.CATALOG_DB_PATH ? path.resolve(process.env.CATALOG_DB_PATH) : DEFAULT_DB_PATH;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS repositories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    repo_url TEXT NOT NULL,
    dockerfile_path TEXT NOT NULL,
    ingest_status TEXT NOT NULL DEFAULT 'seed',
    updated_at TEXT NOT NULL,
    last_ingested_at TEXT,
    ingest_error TEXT,
    ingest_attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    description TEXT,
    UNIQUE(key, value)
  );

  CREATE TABLE IF NOT EXISTS repository_tags (
    repository_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'seed',
    PRIMARY KEY (repository_id, tag_id),
    FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ingestion_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repository_id TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    attempt INTEGER,
    commit_sha TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_ingestion_events_repo_created
    ON ingestion_events(repository_id, datetime(created_at) DESC);
`);

function ensureColumn(table: string, column: string, ddl: string) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!rows.some((row) => row.name === column)) {
    db.exec(ddl);
  }
}

ensureColumn('repositories', 'ingest_error', 'ALTER TABLE repositories ADD COLUMN ingest_error TEXT');
ensureColumn(
  'repositories',
  'ingest_attempts',
  'ALTER TABLE repositories ADD COLUMN ingest_attempts INTEGER NOT NULL DEFAULT 0'
);
ensureColumn(
  'ingestion_events',
  'commit_sha',
  'ALTER TABLE ingestion_events ADD COLUMN commit_sha TEXT'
);
ensureColumn(
  'ingestion_events',
  'duration_ms',
  'ALTER TABLE ingestion_events ADD COLUMN duration_ms INTEGER'
);

type RepositoryRow = {
  id: string;
  name: string;
  description: string;
  repo_url: string;
  dockerfile_path: string;
  ingest_status: IngestStatus;
  updated_at: string;
  last_ingested_at: string | null;
  ingest_error: string | null;
  ingest_attempts: number;
  created_at: string;
};

type TagRow = {
  key: string;
  value: string;
  source: string;
};

type IngestionEventRow = {
  id: number;
  repository_id: string;
  status: IngestStatus;
  message: string | null;
  attempt: number | null;
  commit_sha: string | null;
  duration_ms: number | null;
  created_at: string;
};

const seedApps: RepositoryInsert[] = [
  {
    id: 'astro-notebook',
    name: 'Astro Notebook',
    description:
      'Interactive notebook for Astro projects with live preview and docs integration.',
    repoUrl: 'https://github.com/example/astro-notebook',
    dockerfilePath: 'Dockerfile',
    updatedAt: new Date('2024-04-20T10:15:00Z').toISOString(),
    ingestStatus: 'ready',
    lastIngestedAt: new Date('2024-04-20T10:15:00Z').toISOString(),
    tags: [
      { key: 'framework', value: 'astro' },
      { key: 'category', value: 'docs' },
      { key: 'language', value: 'typescript' },
      { key: 'runtime', value: 'node18' }
    ]
  },
  {
    id: 'stream-sync',
    name: 'Stream Sync',
    description:
      'Collaborative video room with synchronized playback and chat overlay.',
    repoUrl: 'https://github.com/example/stream-sync',
    dockerfilePath: 'deploy/docker/Dockerfile',
    updatedAt: new Date('2024-04-19T14:42:00Z').toISOString(),
    ingestStatus: 'ready',
    lastIngestedAt: new Date('2024-04-19T14:42:00Z').toISOString(),
    tags: [
      { key: 'framework', value: 'nextjs' },
      { key: 'category', value: 'media' },
      { key: 'language', value: 'typescript' },
      { key: 'runtime', value: 'node18' }
    ]
  },
  {
    id: 'ml-dashboard',
    name: 'ML Dashboard',
    description: 'Monitor ML experiments with charts, alerts, and artifact browser.',
    repoUrl: 'https://github.com/example/ml-dashboard',
    dockerfilePath: 'Dockerfile',
    updatedAt: new Date('2024-04-17T09:00:00Z').toISOString(),
    ingestStatus: 'ready',
    lastIngestedAt: new Date('2024-04-17T09:00:00Z').toISOString(),
    tags: [
      { key: 'framework', value: 'streamlit' },
      { key: 'category', value: 'analytics' },
      { key: 'language', value: 'python' },
      { key: 'runtime', value: 'python3.11' }
    ]
  },
  {
    id: 'kanban-live',
    name: 'Kanban Live',
    description: 'Real-time kanban board with multiplayer cursors and Slack integration.',
    repoUrl: 'https://github.com/example/kanban-live',
    dockerfilePath: 'ops/Dockerfile',
    updatedAt: new Date('2024-04-16T11:30:00Z').toISOString(),
    ingestStatus: 'ready',
    lastIngestedAt: new Date('2024-04-16T11:30:00Z').toISOString(),
    tags: [
      { key: 'framework', value: 'remix' },
      { key: 'category', value: 'productivity' },
      { key: 'language', value: 'typescript' },
      { key: 'runtime', value: 'node20' }
    ]
  }
];

const insertRepositoryStatement = db.prepare(`
  INSERT INTO repositories (id, name, description, repo_url, dockerfile_path, ingest_status, updated_at, last_ingested_at, ingest_error, ingest_attempts)
  VALUES (@id, @name, @description, @repoUrl, @dockerfilePath, @ingestStatus, @updatedAt, @lastIngestedAt, @ingestError, @ingestAttempts)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    repo_url = excluded.repo_url,
    dockerfile_path = excluded.dockerfile_path,
    ingest_status = excluded.ingest_status,
    updated_at = excluded.updated_at,
    last_ingested_at = excluded.last_ingested_at,
    ingest_error = excluded.ingest_error,
    ingest_attempts = excluded.ingest_attempts
`);

const findTagStatement = db.prepare('SELECT id FROM tags WHERE key = ? AND value = ?');

const insertTagStatement = db.prepare('INSERT INTO tags (key, value, description) VALUES (?, ?, ?)');

const insertRepositoryTagStatement = db.prepare(
  `INSERT OR IGNORE INTO repository_tags (repository_id, tag_id, source) VALUES (@repositoryId, @tagId, @source)`
);

const deleteRepositoryTagsStatement = db.prepare('DELETE FROM repository_tags WHERE repository_id = ?');

const selectRepositoryTagsStatement = db.prepare(
  `SELECT t.key, t.value, rt.source
   FROM tags t
   JOIN repository_tags rt ON rt.tag_id = t.id
   WHERE rt.repository_id = ?
   ORDER BY t.key ASC, t.value ASC`
);

const selectRepositoriesStatement = db.prepare('SELECT * FROM repositories ORDER BY datetime(updated_at) DESC');

const selectRepositoryByIdStatement = db.prepare('SELECT * FROM repositories WHERE id = ?');

const insertIngestionEventStatement = db.prepare(
  `INSERT INTO ingestion_events (repository_id, status, message, attempt, commit_sha, duration_ms, created_at)
   VALUES (@repositoryId, @status, @message, @attempt, @commitSha, @durationMs, @createdAt)`
);

const selectIngestionEventsStatement = db.prepare(
  `SELECT * FROM ingestion_events
   WHERE repository_id = ?
   ORDER BY datetime(created_at) DESC
   LIMIT ?`
);

function attachTags(repositoryId: string, tags: (TagKV & { source?: string })[] = []) {
  for (const tag of tags) {
    const normalized = {
      key: tag.key.trim(),
      value: tag.value.trim()
    };
    if (!normalized.key || !normalized.value) {
      continue;
    }
    const existing = findTagStatement.get(normalized.key, normalized.value) as { id: number } | undefined;
    const tagId = existing
      ? existing.id
      : Number(insertTagStatement.run(normalized.key, normalized.value, null).lastInsertRowid);
    insertRepositoryTagStatement.run({ repositoryId, tagId, source: tag.source ?? 'seed' });
  }
}

function rowToEvent(row: IngestionEventRow): IngestionEvent {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    status: row.status,
    message: row.message,
    attempt: row.attempt,
    commitSha: row.commit_sha,
    durationMs: row.duration_ms,
    createdAt: row.created_at
  };
}

function logIngestionEvent(params: {
  repositoryId: string;
  status: IngestStatus;
  message?: string | null;
  attempt?: number | null;
  commitSha?: string | null;
  durationMs?: number | null;
  createdAt?: string;
}) {
  insertIngestionEventStatement.run({
    repositoryId: params.repositoryId,
    status: params.status,
    message: params.message ?? null,
    attempt: params.attempt ?? null,
    commitSha: params.commitSha ?? null,
    durationMs: params.durationMs ?? null,
    createdAt: params.createdAt ?? new Date().toISOString()
  });
}

export function seedDatabase() {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM repositories').get() as
    | { count: number }
    | undefined;
  if ((countRow?.count ?? 0) > 0) {
    return;
  }

  const seedTransaction = db.transaction(() => {
    for (const repository of seedApps) {
      insertRepositoryStatement.run({
        ...repository,
        ingestStatus: repository.ingestStatus ?? 'seed',
        updatedAt: repository.updatedAt ?? new Date().toISOString(),
        lastIngestedAt: repository.lastIngestedAt ?? null,
        ingestError: repository.ingestError ?? null,
        ingestAttempts: repository.ingestAttempts ?? 0
      });
      attachTags(repository.id, repository.tags ?? []);
    }
  });

  seedTransaction();
}

seedDatabase();

function rowToRepository(row: RepositoryRow): RepositoryRecord {
  const tagRows = selectRepositoryTagsStatement.all(row.id) as TagRow[];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    repoUrl: row.repo_url,
    dockerfilePath: row.dockerfile_path,
    updatedAt: row.updated_at,
    ingestStatus: row.ingest_status,
    lastIngestedAt: row.last_ingested_at,
    createdAt: row.created_at,
    ingestError: row.ingest_error,
    ingestAttempts: row.ingest_attempts ?? 0,
    tags: tagRows.map((tag) => ({ key: tag.key, value: tag.value, source: tag.source }))
  };
}

export function listRepositories(params: RepositorySearchParams): RepositoryRecord[] {
  const conditions: string[] = [];
  const substitutions: unknown[] = [];

  if (params.text) {
    const pattern = `%${params.text.toLowerCase()}%`;
    conditions.push('(lower(name) LIKE ? OR lower(description) LIKE ? OR lower(repo_url) LIKE ? )');
    substitutions.push(pattern, pattern, pattern);
  }

  if (params.tags && params.tags.length > 0) {
    for (const tag of params.tags) {
      const normalizedKey = tag.key.toLowerCase();
      const normalizedValue = tag.value.toLowerCase();
      conditions.push(`EXISTS (
        SELECT 1
        FROM repository_tags rt
        JOIN tags t ON t.id = rt.tag_id
        WHERE rt.repository_id = repositories.id
          AND lower(t.key) = ?
          AND lower(t.value) = ?
      )`);
      substitutions.push(normalizedKey, normalizedValue);
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM repositories ${whereClause} ORDER BY datetime(updated_at) DESC`;
  const statement = db.prepare(sql);
  const rows = statement.all(...substitutions) as RepositoryRow[];
  return rows.map(rowToRepository);
}

export function getRepositoryById(id: string): RepositoryRecord | null {
  const row = selectRepositoryByIdStatement.get(id) as RepositoryRow | undefined;
  return row ? rowToRepository(row) : null;
}

export function getIngestionHistory(repositoryId: string, limit = 25): IngestionEvent[] {
  const rows = selectIngestionEventsStatement.all(repositoryId, limit) as IngestionEventRow[];
  return rows.map(rowToEvent);
}

export function upsertRepository(repository: RepositoryInsert): RepositoryRecord {
  const transaction = db.transaction(() => {
    const existing = selectRepositoryByIdStatement.get(repository.id) as
      | RepositoryRow
      | undefined;

    const payload = {
      ...repository,
      ingestStatus: repository.ingestStatus ?? existing?.ingest_status ?? 'pending',
      updatedAt: repository.updatedAt ?? new Date().toISOString(),
      lastIngestedAt: repository.lastIngestedAt ?? existing?.last_ingested_at ?? null,
      ingestError: repository.ingestError ?? existing?.ingest_error ?? null,
      ingestAttempts: repository.ingestAttempts ?? existing?.ingest_attempts ?? 0
    };

    insertRepositoryStatement.run(payload);
    if (repository.tags) {
      deleteRepositoryTagsStatement.run(repository.id);
      attachTags(repository.id, repository.tags);
    }
    return rowToRepository(selectRepositoryByIdStatement.get(repository.id) as RepositoryRow);
  });

  return transaction();
}

export function addRepository(repository: RepositoryInsert): RepositoryRecord {
  const newRepo = {
    ...repository,
    ingestStatus: repository.ingestStatus ?? 'pending',
    updatedAt: repository.updatedAt ?? new Date().toISOString(),
    lastIngestedAt: repository.lastIngestedAt ?? null,
    ingestError: repository.ingestError ?? null,
    ingestAttempts: repository.ingestAttempts ?? 0
  };

  const transaction = db.transaction(() => {
    insertRepositoryStatement.run(newRepo);
    if (repository.tags && repository.tags.length > 0) {
      attachTags(repository.id, repository.tags.map((tag) => ({ ...tag, source: tag.source ?? 'author' })));
    }
    return rowToRepository(selectRepositoryByIdStatement.get(repository.id) as RepositoryRow);
  });

  const record = transaction();
  setRepositoryStatus(record.id, record.ingestStatus, {
    updatedAt: record.updatedAt,
    ingestError: record.ingestError,
    eventMessage: 'Queued for ingestion'
  });
  return getRepositoryById(record.id) ?? record;
}

export function replaceRepositoryTags(
  repositoryId: string,
  tags: TagKV[],
  options: { clearExisting?: boolean; source?: string } = {}
) {
  const source = options.source ?? 'system';
  const transaction = db.transaction(() => {
    if (options.clearExisting ?? true) {
      deleteRepositoryTagsStatement.run(repositoryId);
    }
    attachTags(
      repositoryId,
      tags.map((tag) => ({ ...tag, source: tag.source ?? source }))
    );
  });
  transaction();
}

export function listTagSuggestions(prefix: string, limit: number): TagSuggestion[] {
  const normalized = prefix.trim().toLowerCase();
  const results: TagSuggestion[] = [];

  const keys = normalized
    ? db
        .prepare<[{ pattern: string; limit: number }], { key: string }>(
          `SELECT DISTINCT key FROM tags WHERE lower(key) LIKE @pattern ORDER BY key ASC LIMIT @limit`
        )
        .all({ pattern: `${normalized}%`, limit })
    : db
        .prepare<{ limit: number }, { key: string }>(
          `SELECT key FROM tags GROUP BY key ORDER BY COUNT(*) DESC, key ASC LIMIT @limit`
        )
        .all({ limit });

  for (const row of keys) {
    if (results.length >= limit) {
      break;
    }
    results.push({ type: 'key', value: row.key, label: `${row.key}:` });
  }

  if (results.length >= limit) {
    return results.slice(0, limit);
  }

  const remaining = limit - results.length;
  const pairs = normalized
    ? db
        .prepare<[{ pattern: string; limit: number }], { key: string; value: string }>(
          `SELECT key, value
           FROM tags
           WHERE lower(key || ':' || value) LIKE @pattern
           ORDER BY key ASC, value ASC
           LIMIT @limit`
        )
        .all({ pattern: `${normalized}%`, limit: remaining })
    : db
        .prepare<{ limit: number }, { key: string; value: string }>(
          `SELECT t.key, t.value
           FROM tags t
           JOIN repository_tags rt ON rt.tag_id = t.id
           GROUP BY t.key, t.value
           ORDER BY COUNT(rt.repository_id) DESC, t.key ASC, t.value ASC
           LIMIT @limit`
        )
        .all({ limit: remaining });

  for (const row of pairs) {
    if (results.length >= limit) {
      break;
    }
    results.push({ type: 'pair', value: `${row.key}:${row.value}`, label: `${row.key}:${row.value}` });
  }

  return results.slice(0, limit);
}

export function setRepositoryStatus(
  repositoryId: string,
  status: IngestStatus,
  extra: Partial<{
    updatedAt: string;
    lastIngestedAt: string | null;
    ingestError: string | null;
    incrementAttempts: boolean;
    eventMessage: string | null;
    commitSha: string | null;
    durationMs: number | null;
  }> = {}
) {
  const statement = db.prepare(
    `UPDATE repositories
     SET ingest_status = @status,
         updated_at = COALESCE(@updatedAt, updated_at),
         last_ingested_at = COALESCE(@lastIngestedAt, last_ingested_at),
         ingest_error = @ingestError,
         ingest_attempts = CASE WHEN @incrementAttempts = 1 THEN ingest_attempts + 1 ELSE ingest_attempts END
     WHERE id = @repositoryId`
  );

  statement.run({
    repositoryId,
    status,
    updatedAt: extra.updatedAt ?? null,
    lastIngestedAt: extra.lastIngestedAt ?? null,
    ingestError: extra.ingestError ?? null,
    incrementAttempts: extra.incrementAttempts ? 1 : 0
  });

  const row = selectRepositoryByIdStatement.get(repositoryId) as RepositoryRow | undefined;
  if (row) {
    const message = extra.eventMessage ?? extra.ingestError ?? row.ingest_error ?? null;
    logIngestionEvent({
      repositoryId,
      status,
      message,
      attempt: row.ingest_attempts,
      createdAt: row.updated_at,
      commitSha: extra.commitSha ?? null,
      durationMs: extra.durationMs ?? null
    });
  }
}

export function takeNextPendingRepository(): RepositoryRecord | null {
  const transaction = db.transaction(() => {
    const row = db
      .prepare<[], RepositoryRow | undefined>(
        `SELECT * FROM repositories
         WHERE ingest_status = 'pending'
         ORDER BY datetime(created_at) ASC
         LIMIT 1`
      )
      .get();

    if (!row) {
      return null;
    }

    const now = new Date().toISOString();
    db
      .prepare(
        'UPDATE repositories SET ingest_status = ?, ingest_error = NULL, updated_at = ? WHERE id = ?'
      )
      .run('processing', now, row.id);
    row.ingest_status = 'processing';
    row.ingest_error = null;
    row.updated_at = now;
    return rowToRepository(row);
  });

  return transaction();
}

export function getAllRepositories(): RepositoryRecord[] {
  return (selectRepositoriesStatement.all() as RepositoryRow[]).map(rowToRepository);
}
