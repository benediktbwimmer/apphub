import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { migrateIfNeeded } from './dbMigrations';
import { emitApphubEvent } from './events';
import type { ManifestEnvVarInput } from './serviceManifestTypes';

export type TagKV = {
  key: string;
  value: string;
  source?: string;
};

export type BuildStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type BuildRecord = {
  id: string;
  repositoryId: string;
  status: BuildStatus;
  logs: string | null;
  imageTag: string | null;
  errorMessage: string | null;
  commitSha: string | null;
  gitBranch: string | null;
  gitRef: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
};

export type LaunchStatus =
  | 'pending'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed';

export type LaunchEnvVar = {
  key: string;
  value: string;
};

export type LaunchRecord = {
  id: string;
  repositoryId: string;
  buildId: string;
  status: LaunchStatus;
  instanceUrl: string | null;
  containerId: string | null;
  port: number | null;
  resourceProfile: string | null;
  env: LaunchEnvVar[];
  command: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  expiresAt: string | null;
};

export type ServiceNetworkMemberRecord = {
  networkRepositoryId: string;
  memberRepositoryId: string;
  launchOrder: number;
  waitForBuild: boolean;
  env: ManifestEnvVarInput[];
  dependsOn: string[];
  createdAt: string;
  updatedAt: string;
};

export type ServiceNetworkRecord = {
  repositoryId: string;
  manifestSource: string | null;
  createdAt: string;
  updatedAt: string;
  members: ServiceNetworkMemberRecord[];
};

export type ServiceNetworkMemberInput = {
  memberRepositoryId: string;
  launchOrder?: number;
  waitForBuild?: boolean;
  env?: ManifestEnvVarInput[];
  dependsOn?: string[];
};

export type ServiceNetworkUpsertInput = {
  repositoryId: string;
  manifestSource?: string | null;
};

export type ServiceNetworkLaunchMemberRecord = {
  networkLaunchId: string;
  memberLaunchId: string;
  memberRepositoryId: string;
  launchOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type ServiceNetworkLaunchMemberInput = {
  memberLaunchId: string;
  memberRepositoryId: string;
  launchOrder: number;
};

export type RepositoryPreviewKind = 'gif' | 'image' | 'video' | 'storybook' | 'embed';

export type RepositoryPreview = {
  id: number;
  repositoryId: string;
  kind: RepositoryPreviewKind;
  title: string | null;
  description: string | null;
  src: string | null;
  embedUrl: string | null;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
  source: string;
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
  latestBuild: BuildRecord | null;
  latestLaunch: LaunchRecord | null;
  previewTiles: RepositoryPreview[];
  launchEnvTemplates: LaunchEnvVar[];
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
  launchEnvTemplates?: LaunchEnvVar[];
};

export type RepositorySort = 'updated' | 'name' | 'relevance';

export type RelevanceWeights = {
  name: number;
  description: number;
  tags: number;
};

export type RepositorySearchParams = {
  text?: string;
  tags?: TagKV[];
  statuses?: IngestStatus[];
  ingestedAfter?: string | null;
  ingestedBefore?: string | null;
  sort?: RepositorySort;
  relevanceWeights?: Partial<RelevanceWeights>;
};

export type TagFacet = {
  key: string;
  value: string;
  count: number;
};

export type StatusFacet = {
  status: IngestStatus;
  count: number;
};

export type RepositoryRelevanceComponent = {
  hits: number;
  score: number;
  weight: number;
};

export type RepositoryRelevance = {
  score: number;
  normalizedScore: number;
  components: {
    name: RepositoryRelevanceComponent;
    description: RepositoryRelevanceComponent;
    tags: RepositoryRelevanceComponent;
  };
};

export type RepositoryRecordWithRelevance = RepositoryRecord & {
  relevance?: RepositoryRelevance;
};

export type RepositorySearchMeta = {
  tokens: string[];
  sort: RepositorySort;
  weights: RelevanceWeights;
};

export type RepositorySearchResult = {
  records: RepositoryRecordWithRelevance[];
  total: number;
  facets: {
    tags: TagFacet[];
    statuses: StatusFacet[];
    owners: TagFacet[];
    frameworks: TagFacet[];
  };
  meta: RepositorySearchMeta;
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

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ServiceStatus = 'unknown' | 'healthy' | 'degraded' | 'unreachable';

export type ServiceKind = string;

export type ServiceRecord = {
  id: string;
  slug: string;
  displayName: string;
  kind: ServiceKind;
  baseUrl: string;
  status: ServiceStatus;
  statusMessage: string | null;
  capabilities: JsonValue | null;
  metadata: JsonValue | null;
  lastHealthyAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ServiceUpsertInput = {
  slug: string;
  displayName: string;
  kind: ServiceKind;
  baseUrl: string;
  status?: ServiceStatus;
  statusMessage?: string | null;
  capabilities?: JsonValue | null;
  metadata?: JsonValue | null;
};

export type ServiceStatusUpdate = {
  status?: ServiceStatus;
  statusMessage?: string | null;
  metadata?: JsonValue | null;
  baseUrl?: string;
  lastHealthyAt?: string | null;
  capabilities?: JsonValue | null;
};

const DEFAULT_DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'catalog.db');

const dbPath = process.env.CATALOG_DB_PATH ? path.resolve(process.env.CATALOG_DB_PATH) : DEFAULT_DB_PATH;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

migrateIfNeeded(db);

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
    launch_env_templates TEXT,
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

  CREATE TABLE IF NOT EXISTS builds (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL,
    status TEXT NOT NULL,
    logs TEXT,
    image_tag TEXT,
    error_message TEXT,
    commit_sha TEXT,
    branch TEXT,
    git_ref TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER,
    FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_builds_repo_created
    ON builds(repository_id, datetime(created_at) DESC);

CREATE INDEX IF NOT EXISTS idx_builds_status
    ON builds(status);

  CREATE TABLE IF NOT EXISTS launches (
    id TEXT PRIMARY KEY,
    repository_id TEXT NOT NULL,
    build_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    instance_url TEXT,
    container_id TEXT,
    port INTEGER,
    resource_profile TEXT,
    command TEXT,
    env_vars TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    stopped_at TEXT,
    expires_at TEXT,
    FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE,
    FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_launches_repo_created
    ON launches(repository_id, datetime(created_at) DESC);

  CREATE INDEX IF NOT EXISTS idx_launches_status
    ON launches(status);

  CREATE TABLE IF NOT EXISTS service_networks (
    repository_id TEXT PRIMARY KEY,
    manifest_source TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS service_network_members (
    network_repository_id TEXT NOT NULL,
    member_repository_id TEXT NOT NULL,
    launch_order INTEGER NOT NULL DEFAULT 0,
    wait_for_build INTEGER NOT NULL DEFAULT 1,
    env_vars TEXT,
    depends_on TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (network_repository_id, member_repository_id),
    FOREIGN KEY (network_repository_id) REFERENCES service_networks(repository_id) ON DELETE CASCADE,
    FOREIGN KEY (member_repository_id) REFERENCES repositories(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS service_network_launch_members (
    network_launch_id TEXT NOT NULL,
    member_launch_id TEXT NOT NULL,
    member_repository_id TEXT NOT NULL,
    launch_order INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (network_launch_id, member_repository_id),
    FOREIGN KEY (network_launch_id) REFERENCES launches(id) ON DELETE CASCADE,
    FOREIGN KEY (member_launch_id) REFERENCES launches(id) ON DELETE CASCADE,
    FOREIGN KEY (member_repository_id) REFERENCES repositories(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS repository_previews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repository_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    source TEXT NOT NULL,
    title TEXT,
    description TEXT,
    src TEXT,
    embed_url TEXT,
    poster_url TEXT,
    width INTEGER,
    height INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_repository_previews_repo_sort
    ON repository_previews(repository_id, sort_order);
`);

db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS repository_search USING fts5(
    repository_id UNINDEXED,
    name,
    description,
    repo_url,
    tag_text,
    tokenize = 'porter'
  );
`);

db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS repository_search USING fts5(
    repository_id UNINDEXED,
    name,
    description,
    repo_url,
    tag_text,
    tokenize = 'porter'
  );
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
  'repositories',
  'launch_env_templates',
  'ALTER TABLE repositories ADD COLUMN launch_env_templates TEXT'
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
ensureColumn('launches', 'env_vars', 'ALTER TABLE launches ADD COLUMN env_vars TEXT');
ensureColumn('launches', 'command', 'ALTER TABLE launches ADD COLUMN command TEXT');
ensureColumn('builds', 'branch', 'ALTER TABLE builds ADD COLUMN branch TEXT');
ensureColumn('builds', 'git_ref', 'ALTER TABLE builds ADD COLUMN git_ref TEXT');

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
  launch_env_templates: string | null;
  created_at: string;
};

type TagRow = {
  key: string;
  value: string;
  source: string;
};

type PreviewRow = {
  id: number;
  repository_id: string;
  kind: string;
  source: string;
  title: string | null;
  description: string | null;
  src: string | null;
  embed_url: string | null;
  poster_url: string | null;
  width: number | null;
  height: number | null;
  sort_order: number;
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

type BuildRow = {
  id: string;
  repository_id: string;
  status: BuildStatus;
  logs: string | null;
  image_tag: string | null;
  error_message: string | null;
  commit_sha: string | null;
  branch: string | null;
  git_ref: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
};

type LaunchRow = {
  id: string;
  repository_id: string;
  build_id: string;
  status: LaunchStatus;
  instance_url: string | null;
  container_id: string | null;
  port: number | null;
  resource_profile: string | null;
  command: string | null;
  env_vars: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  stopped_at: string | null;
  expires_at: string | null;
};

type ServiceNetworkRow = {
  repository_id: string;
  manifest_source: string | null;
  created_at: string;
  updated_at: string;
};

type ServiceNetworkMemberRow = {
  network_repository_id: string;
  member_repository_id: string;
  launch_order: number;
  wait_for_build: number;
  env_vars: string | null;
  depends_on: string | null;
  created_at: string;
  updated_at: string;
};

type ServiceNetworkLaunchMemberRow = {
  network_launch_id: string;
  member_launch_id: string;
  member_repository_id: string;
  launch_order: number;
  created_at: string;
  updated_at: string;
};

type ServiceRow = {
  id: string;
  slug: string;
  display_name: string;
  kind: string;
  base_url: string;
  status: ServiceStatus;
  status_message: string | null;
  capabilities: string | null;
  metadata: string | null;
  last_healthy_at: string | null;
  created_at: string;
  updated_at: string;
};

const insertRepositoryStatement = db.prepare(`
  INSERT INTO repositories (id, name, description, repo_url, dockerfile_path, ingest_status, updated_at, last_ingested_at, ingest_error, ingest_attempts, launch_env_templates)
  VALUES (@id, @name, @description, @repoUrl, @dockerfilePath, @ingestStatus, @updatedAt, @lastIngestedAt, @ingestError, @ingestAttempts, @launchEnvTemplates)
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    repo_url = excluded.repo_url,
    dockerfile_path = excluded.dockerfile_path,
    ingest_status = excluded.ingest_status,
    updated_at = excluded.updated_at,
    last_ingested_at = excluded.last_ingested_at,
    ingest_error = excluded.ingest_error,
    ingest_attempts = excluded.ingest_attempts,
    launch_env_templates = excluded.launch_env_templates
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

const deleteRepositoryPreviewsStatement = db.prepare('DELETE FROM repository_previews WHERE repository_id = ?');

const insertRepositoryPreviewStatement = db.prepare(
  `INSERT INTO repository_previews (
     repository_id,
     kind,
     source,
     title,
     description,
     src,
     embed_url,
     poster_url,
     width,
     height,
     sort_order
   ) VALUES (
     @repositoryId,
     @kind,
     @source,
     @title,
     @description,
     @src,
     @embedUrl,
     @posterUrl,
     @width,
     @height,
     @sortOrder
   )`
);

const updateRepositoryEnvTemplatesStatement = db.prepare(
  `UPDATE repositories
     SET launch_env_templates = @launchEnvTemplates,
         updated_at = @updatedAt
   WHERE id = @repositoryId`
);

const selectRepositoryPreviewsStatement = db.prepare(
  `SELECT *
     FROM repository_previews
    WHERE repository_id = ?
    ORDER BY sort_order ASC, id ASC`
);

const selectRepositoriesStatement = db.prepare('SELECT * FROM repositories ORDER BY datetime(updated_at) DESC');

const selectRepositoryByIdStatement = db.prepare('SELECT * FROM repositories WHERE id = ?');

const selectServicesStatement = db.prepare(
  'SELECT * FROM services ORDER BY display_name ASC, datetime(updated_at) DESC'
);

const selectServiceBySlugStatement = db.prepare('SELECT * FROM services WHERE slug = ?');

const insertServiceStatement = db.prepare(
  `INSERT INTO services (
     id,
     slug,
     display_name,
     kind,
     base_url,
     status,
     status_message,
     capabilities,
     metadata,
     last_healthy_at,
     created_at,
     updated_at
   ) VALUES (
     @id,
     @slug,
     @displayName,
     @kind,
     @baseUrl,
     @status,
     @statusMessage,
     @capabilities,
     @metadata,
     @lastHealthyAt,
     @createdAt,
     @updatedAt
   )`
);

const updateServiceStatement = db.prepare(
  `UPDATE services
     SET display_name = @displayName,
         kind = @kind,
         base_url = @baseUrl,
         status = @status,
         status_message = @statusMessage,
         capabilities = @capabilities,
         metadata = @metadata,
         last_healthy_at = @lastHealthyAt,
         updated_at = @updatedAt
   WHERE slug = @slug`
);

const upsertServiceNetworkStatement = db.prepare(
  `INSERT INTO service_networks (
     repository_id,
     manifest_source,
     created_at,
     updated_at
   ) VALUES (
     @repositoryId,
     @manifestSource,
     @createdAt,
     @updatedAt
   )
   ON CONFLICT(repository_id) DO UPDATE SET
     manifest_source = excluded.manifest_source,
     updated_at = excluded.updated_at`
);

const deleteServiceNetworkStatement = db.prepare('DELETE FROM service_networks WHERE repository_id = ?');

const selectServiceNetworkByIdStatement = db.prepare(
  'SELECT * FROM service_networks WHERE repository_id = ?'
);

const selectAllServiceNetworkIdsStatement = db.prepare(
  'SELECT repository_id FROM service_networks'
);

const insertServiceNetworkMemberStatement = db.prepare(
  `INSERT INTO service_network_members (
     network_repository_id,
     member_repository_id,
     launch_order,
     wait_for_build,
     env_vars,
     depends_on,
     created_at,
     updated_at
   ) VALUES (
     @networkRepositoryId,
     @memberRepositoryId,
     @launchOrder,
     @waitForBuild,
     @envVars,
     @dependsOn,
     @createdAt,
     @updatedAt
   )`
);

const deleteServiceNetworkMembersStatement = db.prepare(
  'DELETE FROM service_network_members WHERE network_repository_id = ?'
);

const selectServiceNetworkMembersStatement = db.prepare(
  'SELECT * FROM service_network_members WHERE network_repository_id = ? ORDER BY launch_order ASC, member_repository_id ASC'
);

const selectNetworksForMemberStatement = db.prepare(
  'SELECT network_repository_id FROM service_network_members WHERE member_repository_id = ?'
);

const insertServiceNetworkLaunchMemberStatement = db.prepare(
  `INSERT INTO service_network_launch_members (
     network_launch_id,
     member_launch_id,
     member_repository_id,
     launch_order,
     created_at,
     updated_at
   ) VALUES (
     @networkLaunchId,
     @memberLaunchId,
     @memberRepositoryId,
     @launchOrder,
     @createdAt,
     @updatedAt
   )`
);

const deleteServiceNetworkLaunchMembersStatement = db.prepare(
  'DELETE FROM service_network_launch_members WHERE network_launch_id = ?'
);

const selectServiceNetworkLaunchMembersStatement = db.prepare(
  'SELECT * FROM service_network_launch_members WHERE network_launch_id = ? ORDER BY launch_order ASC, member_repository_id ASC'
);

const insertRepositorySearchStatement = db.prepare(
  `INSERT INTO repository_search (repository_id, name, description, repo_url, tag_text)
   VALUES (@repositoryId, @name, @description, @repoUrl, @tagText)`
);

const deleteRepositorySearchStatement = db.prepare('DELETE FROM repository_search WHERE repository_id = ?');

const countRepositorySearchStatement = db.prepare('SELECT COUNT(*) AS count FROM repository_search');

function buildTagSearchText(tagRows: TagRow[]): string {
  return tagRows
    .map((tag) => `${tag.key}:${tag.value}`)
    .join(' ');
}

function refreshRepositorySearchIndex(repositoryId: string) {
  const repository = selectRepositoryByIdStatement.get(repositoryId) as RepositoryRow | undefined;
  if (!repository) {
    return;
  }
  const tagRows = selectRepositoryTagsStatement.all(repositoryId) as TagRow[];
  const tagText = buildTagSearchText(tagRows);
  deleteRepositorySearchStatement.run(repositoryId);
  insertRepositorySearchStatement.run({
    repositoryId: repository.id,
    name: repository.name,
    description: repository.description,
    repoUrl: repository.repo_url,
    tagText
  });
}

function hasOwn<T extends object>(obj: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function jsonEquals(a: JsonValue | null, b: JsonValue | null): boolean {
  if (a === b) {
    return true;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

function parseJsonColumn(value: string | null): JsonValue | null {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    return null;
  }
}

function serializeJsonColumn(value: JsonValue | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

function serviceRowToRecord(row: ServiceRow): ServiceRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    kind: row.kind,
    baseUrl: row.base_url,
    status: row.status,
    statusMessage: row.status_message,
    capabilities: parseJsonColumn(row.capabilities),
    metadata: parseJsonColumn(row.metadata),
    lastHealthyAt: row.last_healthy_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rebuildRepositorySearchIndex() {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM repository_search').run();
    const rows = db.prepare('SELECT * FROM repositories').all() as RepositoryRow[];
    for (const row of rows) {
      const tagRows = selectRepositoryTagsStatement.all(row.id) as TagRow[];
      insertRepositorySearchStatement.run({
        repositoryId: row.id,
        name: row.name,
        description: row.description,
        repoUrl: row.repo_url,
        tagText: buildTagSearchText(tagRows)
      });
    }
  });
  transaction();
}

const searchIndexCountRow = countRepositorySearchStatement.get() as { count: number };
if (Number(searchIndexCountRow.count) === 0) {
  rebuildRepositorySearchIndex();
}

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

const selectIngestionEventByIdStatement = db.prepare(
  `SELECT * FROM ingestion_events WHERE id = ?`
);

const insertBuildStatement = db.prepare(
  `INSERT INTO builds (
     id,
     repository_id,
     status,
     logs,
     image_tag,
     error_message,
     commit_sha,
     branch,
     git_ref,
     created_at,
     updated_at,
     started_at,
     completed_at,
     duration_ms
   ) VALUES (
     @id,
     @repositoryId,
     @status,
     @logs,
     @imageTag,
     @errorMessage,
     @commitSha,
     @gitBranch,
     @gitRef,
     @createdAt,
     @updatedAt,
     @startedAt,
     @completedAt,
     @durationMs
   )`
);

const updateBuildStatement = db.prepare(
  `UPDATE builds
   SET status = COALESCE(@status, status),
       logs = COALESCE(@logs, logs),
       image_tag = COALESCE(@imageTag, image_tag),
       error_message = COALESCE(@errorMessage, error_message),
       commit_sha = COALESCE(@commitSha, commit_sha),
       branch = COALESCE(@gitBranch, branch),
       git_ref = COALESCE(@gitRef, git_ref),
       updated_at = COALESCE(@updatedAt, updated_at),
       started_at = COALESCE(@startedAt, started_at),
       completed_at = COALESCE(@completedAt, completed_at),
       duration_ms = COALESCE(@durationMs, duration_ms)
   WHERE id = @buildId`
);

const appendBuildLogStatement = db.prepare(
  `UPDATE builds
   SET logs = COALESCE(logs, '') || @chunk,
       updated_at = @updatedAt
   WHERE id = @buildId`
);

const selectBuildByIdStatement = db.prepare('SELECT * FROM builds WHERE id = ?');

const selectLatestBuildByRepositoryStatement = db.prepare(
  `SELECT * FROM builds
   WHERE repository_id = ?
   ORDER BY datetime(created_at) DESC
   LIMIT 1`
);

const selectPendingBuildStatement = db.prepare(
  `SELECT * FROM builds
   WHERE status = 'pending'
   ORDER BY datetime(created_at) ASC
   LIMIT 1`
);

const selectBuildCountForRepositoryStatement = db.prepare(
  `SELECT COUNT(*) as count
   FROM builds
   WHERE repository_id = ?`
);

const insertLaunchStatement = db.prepare(
  `INSERT INTO launches (
     id,
     repository_id,
     build_id,
     status,
     instance_url,
     container_id,
     port,
     resource_profile,
     command,
     env_vars,
     error_message,
     created_at,
     updated_at,
     started_at,
     stopped_at,
     expires_at
   ) VALUES (
     @id,
     @repositoryId,
     @buildId,
     @status,
     @instanceUrl,
     @containerId,
     @port,
     @resourceProfile,
     @command,
     @env,
     @errorMessage,
     @createdAt,
     @updatedAt,
     @startedAt,
     @stoppedAt,
     @expiresAt
   )`
);

const updateLaunchStatement = db.prepare(
  `UPDATE launches
   SET status = CASE WHEN @statusSet = 1 THEN @status ELSE status END,
       instance_url = CASE WHEN @instanceUrlSet = 1 THEN @instanceUrl ELSE instance_url END,
       container_id = CASE WHEN @containerIdSet = 1 THEN @containerId ELSE container_id END,
       port = CASE WHEN @portSet = 1 THEN @port ELSE port END,
       resource_profile = CASE WHEN @resourceProfileSet = 1 THEN @resourceProfile ELSE resource_profile END,
       command = CASE WHEN @commandSet = 1 THEN @command ELSE command END,
       env_vars = CASE WHEN @envSet = 1 THEN @env ELSE env_vars END,
       error_message = CASE WHEN @errorMessageSet = 1 THEN @errorMessage ELSE error_message END,
       updated_at = COALESCE(@updatedAt, updated_at),
       started_at = CASE WHEN @startedAtSet = 1 THEN @startedAt ELSE started_at END,
       stopped_at = CASE WHEN @stoppedAtSet = 1 THEN @stoppedAt ELSE stopped_at END,
       expires_at = CASE WHEN @expiresAtSet = 1 THEN @expiresAt ELSE expires_at END
   WHERE id = @launchId`
);

const selectLaunchByIdStatement = db.prepare('SELECT * FROM launches WHERE id = ?');

const selectLaunchesByRepositoryStatement = db.prepare(
  `SELECT * FROM launches
   WHERE repository_id = ?
   ORDER BY datetime(created_at) DESC
   LIMIT ?`
);

const selectLatestLaunchByRepositoryStatement = db.prepare(
  `SELECT * FROM launches
   WHERE repository_id = ?
   ORDER BY datetime(created_at) DESC
   LIMIT 1`
);

const selectPendingLaunchStatement = db.prepare(
  `SELECT * FROM launches
   WHERE status = 'pending'
   ORDER BY datetime(created_at) ASC
   LIMIT 1`
);

const selectStoppingLaunchStatement = db.prepare(
  `SELECT * FROM launches
   WHERE status = 'stopping'
   ORDER BY datetime(updated_at) ASC
   LIMIT 1`
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

function rowToBuild(row: BuildRow): BuildRecord {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    status: row.status,
    logs: row.logs,
    imageTag: row.image_tag,
    errorMessage: row.error_message && row.error_message.length > 0 ? row.error_message : null,
    commitSha: row.commit_sha,
    gitBranch: row.branch,
    gitRef: row.git_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms ?? null
  };
}

function parseLaunchEnv(raw: string | null): LaunchEnvVar[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const env: LaunchEnvVar[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const key = typeof (entry as { key?: unknown }).key === 'string' ? (entry as { key: string }).key : '';
      const value = typeof (entry as { value?: unknown }).value === 'string' ? (entry as { value: string }).value : '';
      if (!key) {
        continue;
      }
      env.push({ key, value });
    }
    return env;
  } catch {
    return [];
  }
}

function normalizeLaunchEnvEntries(entries?: LaunchEnvVar[] | null): LaunchEnvVar[] {
  if (!entries || entries.length === 0) {
    return [];
  }
  const seen = new Map<string, string>();
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }
    const key = entry.key.trim();
    if (!key) {
      continue;
    }
    const value = typeof entry.value === 'string' ? entry.value : '';
    if (seen.has(key)) {
      continue;
    }
    seen.set(key, value);
    if (seen.size >= 32) {
      break;
    }
  }
  return Array.from(seen.entries()).map(([key, value]) => ({ key, value }));
}

function parseDependsOn(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
      .filter((entry): entry is string => entry.length > 0);
  } catch {
    return [];
  }
}

function prepareDependsOn(entries?: string[] | null): string | null {
  if (!entries) {
    return null;
  }
  const normalized = Array.from(
    new Set(
      entries
        .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
        .filter((entry) => entry.length > 0)
    )
  );
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

function prepareLaunchEnvForUpsert(
  entries: LaunchEnvVar[] | undefined,
  existing: string | null
): string | null {
  if (entries === undefined) {
    return existing;
  }
  const normalized = normalizeLaunchEnvEntries(entries);
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

const VALID_ENV_PROPERTIES = new Set(['instanceurl', 'baseurl', 'host', 'port']);
type ManifestEnvReference = NonNullable<ManifestEnvVarInput['fromService']>;

function toCanonicalEnvProperty(raw: string): ManifestEnvReference['property'] | null {
  switch (raw.toLowerCase()) {
    case 'instanceurl':
      return 'instanceUrl';
    case 'baseurl':
      return 'baseUrl';
    case 'host':
      return 'host';
    case 'port':
      return 'port';
    default:
      return null;
  }
}

function encodeManifestEnv(entries?: ManifestEnvVarInput[] | null): string | null {
  if (!entries || entries.length === 0) {
    return null;
  }
  const normalized: ManifestEnvVarInput[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }
    const key = entry.key.trim();
    if (!key) {
      continue;
    }
    const clone: ManifestEnvVarInput = { key };
    if (Object.prototype.hasOwnProperty.call(entry, 'value')) {
      clone.value = entry.value;
    }
    const fromService = entry.fromService;
    if (fromService && typeof fromService.service === 'string') {
      const serviceRef = fromService.service.trim().toLowerCase();
      const property =
        typeof fromService.property === 'string'
          ? toCanonicalEnvProperty(fromService.property)
          : null;
      if (serviceRef && property) {
        clone.fromService = {
          service: serviceRef,
          property,
          fallback: fromService.fallback
        };
      }
    }
    normalized.push(clone);
  }
  return normalized.length > 0 ? JSON.stringify(normalized) : null;
}

function parseManifestEnv(raw: string | null): ManifestEnvVarInput[] {
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const result: ManifestEnvVarInput[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const keyRaw = (item as { key?: unknown }).key;
    const key = typeof keyRaw === 'string' ? keyRaw.trim() : '';
    if (!key) {
      continue;
    }
    const entry: ManifestEnvVarInput = { key };
    if (Object.prototype.hasOwnProperty.call(item, 'value')) {
      const valueRaw = (item as { value?: unknown }).value;
      if (typeof valueRaw === 'string') {
        entry.value = valueRaw;
      } else if (valueRaw !== undefined && valueRaw !== null) {
        entry.value = String(valueRaw);
      }
    }
    const refRaw = (item as { fromService?: unknown }).fromService;
    if (refRaw && typeof refRaw === 'object') {
      const serviceRaw = (refRaw as { service?: unknown }).service;
      const propertyRaw = (refRaw as { property?: unknown }).property;
      const fallbackRaw = (refRaw as { fallback?: unknown }).fallback;
    const service = typeof serviceRaw === 'string' ? serviceRaw.trim().toLowerCase() : '';
    const property =
      typeof propertyRaw === 'string' ? toCanonicalEnvProperty(propertyRaw) : null;
    if (service && property) {
      entry.fromService = {
        service,
        property,
        fallback: typeof fallbackRaw === 'string' ? fallbackRaw : undefined
      };
    }
    }
    result.push(entry);
  }
  return result;
}

function rowToLaunch(row: LaunchRow): LaunchRecord {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    buildId: row.build_id,
    status: row.status,
    instanceUrl: row.instance_url,
    containerId: row.container_id,
    port: row.port,
    resourceProfile: row.resource_profile,
    env: parseLaunchEnv(row.env_vars),
    command: row.command ?? null,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    expiresAt: row.expires_at
  };
}

function rowToServiceNetwork(row: ServiceNetworkRow, members: ServiceNetworkMemberRecord[] = []): ServiceNetworkRecord {
  return {
    repositoryId: row.repository_id,
    manifestSource: row.manifest_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    members
  };
}

function rowToServiceNetworkMember(row: ServiceNetworkMemberRow): ServiceNetworkMemberRecord {
  return {
    networkRepositoryId: row.network_repository_id,
    memberRepositoryId: row.member_repository_id,
    launchOrder: row.launch_order ?? 0,
    waitForBuild: row.wait_for_build === 0 ? false : true,
    env: parseManifestEnv(row.env_vars),
    dependsOn: parseDependsOn(row.depends_on),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToServiceNetworkLaunchMember(
  row: ServiceNetworkLaunchMemberRow
): ServiceNetworkLaunchMemberRecord {
  return {
    networkLaunchId: row.network_launch_id,
    memberLaunchId: row.member_launch_id,
    memberRepositoryId: row.member_repository_id,
    launchOrder: row.launch_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToPreview(row: PreviewRow): RepositoryPreview {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    kind: row.kind as RepositoryPreviewKind,
    title: row.title ?? null,
    description: row.description ?? null,
    src: row.src ?? null,
    embedUrl: row.embed_url ?? null,
    posterUrl: row.poster_url ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    sortOrder: row.sort_order ?? 0,
    source: row.source
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
}): IngestionEvent | null {
  const info = insertIngestionEventStatement.run({
    repositoryId: params.repositoryId,
    status: params.status,
    message: params.message ?? null,
    attempt: params.attempt ?? null,
    commitSha: params.commitSha ?? null,
    durationMs: params.durationMs ?? null,
    createdAt: params.createdAt ?? new Date().toISOString()
  });

  const eventId = Number(info.lastInsertRowid);
  if (!Number.isFinite(eventId)) {
    return null;
  }

  const row = selectIngestionEventByIdStatement.get(eventId) as IngestionEventRow | undefined;
  return row ? rowToEvent(row) : null;
}

function notifyRepositoryChanged(repositoryId: string) {
  const repository = getRepositoryById(repositoryId);
  if (!repository) {
    return;
  }
  emitApphubEvent({ type: 'repository.updated', data: { repository } });
}

function notifyBuildChanged(build: BuildRecord | null) {
  if (!build) {
    return;
  }
  emitApphubEvent({ type: 'build.updated', data: { build } });
  notifyRepositoryChanged(build.repositoryId);
}

function notifyLaunchChanged(launch: LaunchRecord | null) {
  if (!launch) {
    return;
  }
  emitApphubEvent({ type: 'launch.updated', data: { launch } });
  notifyRepositoryChanged(launch.repositoryId);
}

function notifyIngestion(event: IngestionEvent | null) {
  if (!event) {
    return;
  }
  emitApphubEvent({ type: 'repository.ingestion-event', data: { event } });
}

function notifyServiceUpdated(service: ServiceRecord | null) {
  if (!service) {
    return;
  }
  emitApphubEvent({ type: 'service.updated', data: { service } });
}

export const ALL_INGEST_STATUSES: IngestStatus[] = ['seed', 'pending', 'processing', 'ready', 'failed'];

type WhereClauseOptions = {
  includeTags?: boolean;
  includeStatuses?: boolean;
  includeText?: boolean;
  tableAlias?: string;
};

function buildRepositoryWhereClause(
  params: RepositorySearchParams,
  options: WhereClauseOptions = {}
) {
  const includeTags = options.includeTags ?? true;
  const includeStatuses = options.includeStatuses ?? true;
  const includeText = options.includeText ?? true;
  const tableAlias = options.tableAlias ?? 'repositories';
  const conditions: string[] = [];
  const substitutions: unknown[] = [];

  if (params.text && includeText) {
    const pattern = `%${params.text.toLowerCase()}%`;
    conditions.push(
      `(
        lower(${tableAlias}.name) LIKE ?
        OR lower(${tableAlias}.description) LIKE ?
        OR lower(${tableAlias}.repo_url) LIKE ?
      )`
    );
    substitutions.push(pattern, pattern, pattern);
  }

  if (includeTags && params.tags && params.tags.length > 0) {
    for (const tag of params.tags) {
      const normalizedKey = tag.key.toLowerCase();
      const normalizedValue = tag.value.toLowerCase();
      conditions.push(`EXISTS (
        SELECT 1
        FROM repository_tags rt
        JOIN tags t ON t.id = rt.tag_id
        WHERE rt.repository_id = ${tableAlias}.id
          AND lower(t.key) = ?
          AND lower(t.value) = ?
      )`);
      substitutions.push(normalizedKey, normalizedValue);
    }
  }

  if (includeStatuses && params.statuses && params.statuses.length > 0) {
    const placeholders = params.statuses.map(() => '?').join(',');
    conditions.push(`${tableAlias}.ingest_status IN (${placeholders})`);
    substitutions.push(...params.statuses);
  }

  if (params.ingestedAfter) {
    conditions.push(
      `${tableAlias}.last_ingested_at IS NOT NULL AND datetime(${tableAlias}.last_ingested_at) >= datetime(?)`
    );
    substitutions.push(params.ingestedAfter);
  }

  if (params.ingestedBefore) {
    conditions.push(
      `${tableAlias}.last_ingested_at IS NOT NULL AND datetime(${tableAlias}.last_ingested_at) <= datetime(?)`
    );
    substitutions.push(params.ingestedBefore);
  }

  const clause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { clause, substitutions };
}

function tokenizeSearchText(text?: string): string[] {
  if (!text) {
    return [];
  }
  const matches = text.toLowerCase().match(/[a-z0-9]+/g);
  if (!matches) {
    return [];
  }
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of matches.slice(0, 12)) {
    if (!seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens;
}

function buildFtsQuery(tokens: string[]): string {
  return tokens.map((token) => `${token}*`).join(' AND ');
}

function rowToRepository(row: RepositoryRow): RepositoryRecord {
  const tagRows = selectRepositoryTagsStatement.all(row.id) as TagRow[];
  const latestBuildRow = selectLatestBuildByRepositoryStatement.get(row.id) as BuildRow | undefined;
  const latestLaunchRow = selectLatestLaunchByRepositoryStatement.get(row.id) as LaunchRow | undefined;
  const previewRows = selectRepositoryPreviewsStatement.all(row.id) as PreviewRow[];
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
    tags: tagRows.map((tag) => ({ key: tag.key, value: tag.value, source: tag.source })),
    latestBuild: latestBuildRow ? rowToBuild(latestBuildRow) : null,
    latestLaunch: latestLaunchRow ? rowToLaunch(latestLaunchRow) : null,
    previewTiles: previewRows.map((preview) => rowToPreview(preview)),
    launchEnvTemplates: parseLaunchEnv(row.launch_env_templates)
  };
}

function computeComponent(
  hits: number,
  weight: number
): RepositoryRelevanceComponent {
  return {
    hits,
    weight,
    score: hits * weight
  };
}

export function listRepositories(params: RepositorySearchParams): RepositorySearchResult {
  const DEFAULT_WEIGHTS: RelevanceWeights = {
    name: 4,
    description: 1.5,
    tags: 2
  };

  const tokens = tokenizeSearchText(params.text);
  const requestedSort: RepositorySort = params.sort ?? (tokens.length > 0 ? 'relevance' : 'updated');
  const effectiveSort: RepositorySort =
    tokens.length === 0 && requestedSort === 'relevance' ? 'updated' : requestedSort;

  const weights: RelevanceWeights = {
    name: params.relevanceWeights?.name ?? DEFAULT_WEIGHTS.name,
    description: params.relevanceWeights?.description ?? DEFAULT_WEIGHTS.description,
    tags: params.relevanceWeights?.tags ?? DEFAULT_WEIGHTS.tags
  };

  const relevanceScores = new Map<string, number>();
  let rows: RepositoryRow[];

  if (tokens.length > 0) {
    const ftsQuery = buildFtsQuery(tokens);
    const filterClause = buildRepositoryWhereClause(params, { includeText: false, tableAlias: 'r' });
    const filterSql = filterClause.clause ? `AND ${filterClause.clause.replace(/^WHERE\s+/i, '')}` : '';
    const orderByClause =
      effectiveSort === 'name'
        ? 'ORDER BY lower(r.name) ASC'
        : effectiveSort === 'updated'
        ? 'ORDER BY datetime(r.updated_at) DESC'
        : 'ORDER BY relevance_score DESC, datetime(r.updated_at) DESC';
    const bm25Weights = [0, weights.name, weights.description, 0.2, weights.tags].join(', ');
    const query = `
      SELECT r.*, 1.0 / (bm25(repository_search, ${bm25Weights}) + 1.0) AS relevance_score
      FROM repositories r
      JOIN repository_search ON repository_search.repository_id = r.id
      WHERE repository_search MATCH ?
      ${filterSql}
      ${orderByClause}
    `;
    const searchRows = db
      .prepare(query)
      .all(ftsQuery, ...filterClause.substitutions) as (RepositoryRow & { relevance_score: number })[];
    for (const row of searchRows) {
      relevanceScores.set(row.id, Number(row.relevance_score ?? 0));
    }
    rows = searchRows;
  } else {
    const baseClause = buildRepositoryWhereClause(params, { tableAlias: 'repositories' });
    const orderByClause =
      effectiveSort === 'name' ? 'ORDER BY lower(name) ASC' : 'ORDER BY datetime(updated_at) DESC';
    const sql = `SELECT * FROM repositories ${baseClause.clause} ${orderByClause}`;
    rows = db.prepare(sql).all(...baseClause.substitutions) as RepositoryRow[];
  }

  const records = rows.map((row) => rowToRepository(row) as RepositoryRecordWithRelevance);

  if (tokens.length > 0) {
    for (const record of records) {
      const lowerName = record.name.toLowerCase();
      const lowerDescription = record.description.toLowerCase();
      const lowerTags = record.tags.map((tag) => `${tag.key}:${tag.value}`).join(' ').toLowerCase();

      let nameHits = 0;
      let descriptionHits = 0;
      let tagHits = 0;

      for (const token of tokens) {
        if (lowerName.includes(token)) {
          nameHits += 1;
        }
        if (lowerDescription.includes(token)) {
          descriptionHits += 1;
        }
        if (lowerTags.includes(token)) {
          tagHits += 1;
        }
      }

      const components = {
        name: computeComponent(nameHits, weights.name),
        description: computeComponent(descriptionHits, weights.description),
        tags: computeComponent(tagHits, weights.tags)
      } satisfies RepositoryRelevance['components'];

      record.relevance = {
        score: components.name.score + components.description.score + components.tags.score,
        normalizedScore: relevanceScores.get(record.id) ?? 0,
        components
      } satisfies RepositoryRelevance;
    }
  }

  const statusCountMap = new Map<IngestStatus, number>();
  for (const status of ALL_INGEST_STATUSES) {
    statusCountMap.set(status, 0);
  }
  const tagCountMap = new Map<string, { key: string; value: string; count: number }>();
  const ownerCountMap = new Map<string, number>();
  const frameworkCountMap = new Map<string, number>();

  for (const record of records) {
    statusCountMap.set(record.ingestStatus, (statusCountMap.get(record.ingestStatus) ?? 0) + 1);
    for (const tag of record.tags) {
      const tagKey = `${tag.key}:${tag.value}`;
      const current = tagCountMap.get(tagKey);
      if (current) {
        current.count += 1;
      } else {
        tagCountMap.set(tagKey, { key: tag.key, value: tag.value, count: 1 });
      }

      if (tag.key.toLowerCase() === 'owner') {
        ownerCountMap.set(tag.value, (ownerCountMap.get(tag.value) ?? 0) + 1);
      }
      if (tag.key.toLowerCase() === 'framework') {
        frameworkCountMap.set(tag.value, (frameworkCountMap.get(tag.value) ?? 0) + 1);
      }
    }
  }

  const statusFacets = ALL_INGEST_STATUSES.map((status) => ({
    status,
    count: statusCountMap.get(status) ?? 0
  }));

  const tagFacets = Array.from(tagCountMap.values())
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      const keyCompare = a.key.localeCompare(b.key);
      if (keyCompare !== 0) {
        return keyCompare;
      }
      return a.value.localeCompare(b.value);
    })
    .slice(0, 50)
    .map((row) => ({ key: row.key, value: row.value, count: row.count }));

  const owners = Array.from(ownerCountMap.entries())
    .map(([value, count]) => ({ key: 'owner', value, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.value.localeCompare(b.value)))
    .slice(0, 10);

  const frameworks = Array.from(frameworkCountMap.entries())
    .map(([value, count]) => ({ key: 'framework', value, count }))
    .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.value.localeCompare(b.value)))
    .slice(0, 10);

  return {
    records,
    total: records.length,
    facets: {
      tags: tagFacets,
      statuses: statusFacets,
      owners,
      frameworks
    },
    meta: {
      tokens,
      sort: effectiveSort,
      weights
    }
  };
}

export function getRepositoryById(id: string): RepositoryRecord | null {
  const row = selectRepositoryByIdStatement.get(id) as RepositoryRow | undefined;
  return row ? rowToRepository(row) : null;
}

export function getIngestionHistory(repositoryId: string, limit = 25): IngestionEvent[] {
  const rows = selectIngestionEventsStatement.all(repositoryId, limit) as IngestionEventRow[];
  return rows.map(rowToEvent);
}

export function getBuildById(id: string): BuildRecord | null {
  const row = selectBuildByIdStatement.get(id) as BuildRow | undefined;
  return row ? rowToBuild(row) : null;
}

export function listBuildsForRepository(
  repositoryId: string,
  options: { limit?: number; offset?: number } = {}
): BuildRecord[] {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const offset = Math.max(0, options.offset ?? 0);
  const statement = db.prepare(
    `SELECT * FROM builds
     WHERE repository_id = ?
     ORDER BY datetime(created_at) DESC
     LIMIT ?
     OFFSET ?`
  );
  const rows = statement.all(repositoryId, limit, offset) as BuildRow[];
  return rows.map(rowToBuild);
}

export function countBuildsForRepository(repositoryId: string): number {
  const row = selectBuildCountForRepositoryStatement.get(repositoryId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function createBuild(
  repositoryId: string,
  options: { commitSha?: string | null; gitBranch?: string | null; gitRef?: string | null } = {}
): BuildRecord {
  const now = new Date().toISOString();
  const gitBranch = options.gitBranch?.trim() ?? null;
  const gitRef = options.gitRef?.trim() ?? null;
  const build = {
    id: randomUUID(),
    repositoryId,
    status: 'pending' as BuildStatus,
    logs: '',
    imageTag: null,
    errorMessage: null,
    commitSha: options.commitSha ?? null,
    gitBranch,
    gitRef,
    createdAt: now,
    updatedAt: now,
    startedAt: null as string | null,
    completedAt: null as string | null,
    durationMs: null as number | null
  } satisfies BuildRecord;

  insertBuildStatement.run({
    id: build.id,
    repositoryId: build.repositoryId,
    status: build.status,
    logs: build.logs,
    imageTag: build.imageTag,
    errorMessage: build.errorMessage,
    commitSha: build.commitSha,
    gitBranch: build.gitBranch,
    gitRef: build.gitRef,
    createdAt: build.createdAt,
    updatedAt: build.updatedAt,
    startedAt: build.startedAt,
    completedAt: build.completedAt,
    durationMs: build.durationMs
  });

  const persisted = getBuildById(build.id) ?? build;
  notifyBuildChanged(persisted);
  return persisted;
}

export function startBuild(buildId: string): BuildRecord | null {
  const transaction = db.transaction(() => {
    const existing = selectBuildByIdStatement.get(buildId) as BuildRow | undefined;
    if (!existing) {
      return null;
    }
    if (existing.status === 'running') {
      return rowToBuild(existing);
    }
    if (existing.status !== 'pending') {
      return null;
    }
    const now = new Date().toISOString();
    updateBuildStatement.run({
      buildId,
      status: 'running',
      logs: undefined,
      imageTag: undefined,
      errorMessage: undefined,
      commitSha: undefined,
      gitBranch: undefined,
      gitRef: undefined,
      updatedAt: now,
      startedAt: existing.started_at ?? now,
      completedAt: undefined,
      durationMs: undefined
    });
    const refreshed = selectBuildByIdStatement.get(buildId) as BuildRow | undefined;
    return refreshed ? rowToBuild(refreshed) : null;
  });

  const result = transaction();
  notifyBuildChanged(result);
  return result;
}

export function takeNextPendingBuild(): BuildRecord | null {
  const transaction = db.transaction(() => {
    const row = selectPendingBuildStatement.get() as BuildRow | undefined;
    if (!row) {
      return null;
    }
    const started = startBuild(row.id);
    return started;
  });

  return transaction();
}

export function appendBuildLog(buildId: string, chunk: string) {
  const now = new Date().toISOString();
  appendBuildLogStatement.run({
    buildId,
    chunk,
    updatedAt: now
  });
}

export function completeBuild(
  buildId: string,
  status: Extract<BuildStatus, 'succeeded' | 'failed'>,
  extra: {
    logs?: string | null;
    imageTag?: string | null;
    errorMessage?: string | null;
    commitSha?: string | null;
    gitBranch?: string | null;
    gitRef?: string | null;
    completedAt?: string;
    durationMs?: number | null;
  } = {}
): BuildRecord | null {
  const existing = getBuildById(buildId);
  const completedAt = extra.completedAt ?? new Date().toISOString();
  const durationFromStart = existing?.startedAt
    ? Math.max(Date.parse(completedAt) - Date.parse(existing.startedAt), 0)
    : null;
  const durationMs = extra.durationMs ?? durationFromStart ?? null;

  updateBuildStatement.run({
    buildId,
    status,
    logs: extra.logs ?? undefined,
    imageTag: extra.imageTag ?? undefined,
    errorMessage: extra.errorMessage ?? undefined,
    commitSha: extra.commitSha ?? undefined,
    gitBranch: extra.gitBranch ?? undefined,
    gitRef: extra.gitRef ?? undefined,
    updatedAt: completedAt,
    startedAt: undefined,
    completedAt,
    durationMs: durationMs ?? undefined
  });

  const updated = getBuildById(buildId);
  notifyBuildChanged(updated);
  return updated;
}

function updateLaunchRecord(
  launchId: string,
  updates: {
    status?: LaunchStatus;
    instanceUrl?: string | null;
    containerId?: string | null;
    port?: number | null;
    resourceProfile?: string | null;
    env?: LaunchEnvVar[] | null;
    command?: string | null;
    errorMessage?: string | null;
    updatedAt?: string;
    startedAt?: string | null;
    stoppedAt?: string | null;
    expiresAt?: string | null;
  }
) {
  updateLaunchStatement.run({
    launchId,
    statusSet: updates.status === undefined ? 0 : 1,
    status: updates.status ?? null,
    instanceUrlSet: updates.instanceUrl === undefined ? 0 : 1,
    instanceUrl: updates.instanceUrl ?? null,
    containerIdSet: updates.containerId === undefined ? 0 : 1,
    containerId: updates.containerId ?? null,
    portSet: updates.port === undefined ? 0 : 1,
    port: updates.port ?? null,
    resourceProfileSet: updates.resourceProfile === undefined ? 0 : 1,
    resourceProfile: updates.resourceProfile ?? null,
    commandSet: updates.command === undefined ? 0 : 1,
    command: updates.command ?? null,
    envSet: updates.env === undefined ? 0 : 1,
    env: JSON.stringify(updates.env ?? []),
    errorMessageSet: updates.errorMessage === undefined ? 0 : 1,
    errorMessage: updates.errorMessage ?? null,
    updatedAt: updates.updatedAt ?? new Date().toISOString(),
    startedAtSet: updates.startedAt === undefined ? 0 : 1,
    startedAt: updates.startedAt ?? null,
    stoppedAtSet: updates.stoppedAt === undefined ? 0 : 1,
    stoppedAt: updates.stoppedAt ?? null,
    expiresAtSet: updates.expiresAt === undefined ? 0 : 1,
    expiresAt: updates.expiresAt ?? null
  });
  const updated = getLaunchById(launchId);
  notifyLaunchChanged(updated);
  return updated;
}

export function createLaunch(
  repositoryId: string,
  buildId: string,
  options: {
    id?: string;
    resourceProfile?: string | null;
    expiresAt?: string | null;
    env?: LaunchEnvVar[] | null;
    command?: string | null;
  } = {}
): LaunchRecord {
  const now = new Date().toISOString();
  const providedId = typeof options.id === 'string' ? options.id.trim() : '';
  const launchId = providedId.length > 0 ? providedId : randomUUID();
  const trimmedCommand = typeof options.command === 'string' ? options.command.trim() : '';
  const launch: LaunchRecord = {
    id: launchId,
    repositoryId,
    buildId,
    status: 'pending',
    instanceUrl: null,
    containerId: null,
    port: null,
    resourceProfile: options.resourceProfile ?? null,
    env: Array.isArray(options.env)
      ? options.env
          .filter((entry): entry is LaunchEnvVar => Boolean(entry && typeof entry.key === 'string'))
          .map((entry) => ({
            key: entry.key,
            value: typeof entry.value === 'string' ? entry.value : ''
          }))
      : [],
    command: trimmedCommand.length > 0 ? trimmedCommand : null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    stoppedAt: null,
    expiresAt: options.expiresAt ?? null
  };

  insertLaunchStatement.run({
    id: launch.id,
    repositoryId: launch.repositoryId,
    buildId: launch.buildId,
    status: launch.status,
    instanceUrl: launch.instanceUrl,
    containerId: launch.containerId,
    port: launch.port,
    resourceProfile: launch.resourceProfile,
    command: launch.command,
    env: JSON.stringify(launch.env),
    errorMessage: launch.errorMessage,
    createdAt: launch.createdAt,
    updatedAt: launch.updatedAt,
    startedAt: launch.startedAt,
    stoppedAt: launch.stoppedAt,
    expiresAt: launch.expiresAt
  });

  const persisted = getLaunchById(launch.id) ?? launch;
  notifyLaunchChanged(persisted);
  return persisted;
}

export function getLaunchById(id: string): LaunchRecord | null {
  const row = selectLaunchByIdStatement.get(id) as LaunchRow | undefined;
  return row ? rowToLaunch(row) : null;
}

export function listLaunchesForRepository(repositoryId: string, limit = 20): LaunchRecord[] {
  const rows = selectLaunchesByRepositoryStatement.all(repositoryId, limit) as LaunchRow[];
  return rows.map(rowToLaunch);
}

export function startLaunch(launchId: string): LaunchRecord | null {
  const transaction = db.transaction(() => {
    const row = selectLaunchByIdStatement.get(launchId) as LaunchRow | undefined;
    if (!row) {
      return null;
    }
    if (row.status === 'starting') {
      return rowToLaunch(row);
    }
    if (!['pending', 'failed', 'stopped'].includes(row.status)) {
      return null;
    }
    const updatedAt = new Date().toISOString();
    updateLaunchStatement.run({
      launchId,
      statusSet: 1,
      status: 'starting',
      instanceUrlSet: 1,
      instanceUrl: null,
      containerIdSet: 1,
      containerId: null,
      portSet: 1,
      port: null,
      resourceProfileSet: 0,
      resourceProfile: null,
      commandSet: 0,
      command: null,
      envSet: 0,
      env: null,
      errorMessageSet: 1,
      errorMessage: null,
      updatedAt,
      startedAtSet: 1,
      startedAt: null,
      stoppedAtSet: 1,
      stoppedAt: null,
      expiresAtSet: 0,
      expiresAt: null
    });
    const refreshed = selectLaunchByIdStatement.get(launchId) as LaunchRow | undefined;
    return refreshed ? rowToLaunch(refreshed) : null;
  });

  const result = transaction();
  notifyLaunchChanged(result);
  return result;
}

export function markLaunchRunning(
  launchId: string,
  details: {
    instanceUrl?: string | null;
    containerId?: string | null;
    port?: number | null;
    startedAt?: string;
    command?: string;
  }
): LaunchRecord | null {
  const startedAt = details.startedAt ?? new Date().toISOString();
  return updateLaunchRecord(launchId, {
    status: 'running',
    instanceUrl: details.instanceUrl ?? null,
    containerId: details.containerId ?? null,
    port: details.port ?? null,
    command: details.command,
    startedAt,
    stoppedAt: null,
    errorMessage: null
  });
}

export function failLaunch(launchId: string, message: string): LaunchRecord | null {
  return updateLaunchRecord(launchId, {
    status: 'failed',
    errorMessage: message,
    containerId: null,
    instanceUrl: null,
    port: null,
    stoppedAt: new Date().toISOString()
  });
}

export function requestLaunchStop(launchId: string): LaunchRecord | null {
  const transaction = db.transaction(() => {
    const row = selectLaunchByIdStatement.get(launchId) as LaunchRow | undefined;
    if (!row) {
      return null;
    }
    if (row.status === 'stopping') {
      return rowToLaunch(row);
    }
    if (!['running', 'starting'].includes(row.status)) {
      return null;
    }
    updateLaunchStatement.run({
      launchId,
      statusSet: 1,
      status: 'stopping',
      instanceUrlSet: 0,
      instanceUrl: null,
      containerIdSet: 0,
      containerId: null,
      portSet: 0,
      port: null,
      resourceProfileSet: 0,
      resourceProfile: null,
      commandSet: 0,
      command: null,
      envSet: 0,
      env: null,
      errorMessageSet: 0,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
      startedAtSet: 0,
      startedAt: null,
      stoppedAtSet: 0,
      stoppedAt: null,
      expiresAtSet: 0,
      expiresAt: null
    });
    const refreshed = selectLaunchByIdStatement.get(launchId) as LaunchRow | undefined;
    return refreshed ? rowToLaunch(refreshed) : null;
  });

  const result = transaction();
  notifyLaunchChanged(result);
  return result;
}

export function markLaunchStopped(
  launchId: string,
  extra: { stoppedAt?: string; errorMessage?: string | null } = {}
): LaunchRecord | null {
  const stoppedAt = extra.stoppedAt ?? new Date().toISOString();
  return updateLaunchRecord(launchId, {
    status: extra.errorMessage ? 'failed' : 'stopped',
    containerId: null,
    instanceUrl: null,
    port: null,
    stoppedAt,
    errorMessage: extra.errorMessage ?? null
  });
}

export function takeNextLaunchToStart(): LaunchRecord | null {
  const transaction = db.transaction(() => {
    const row = selectPendingLaunchStatement.get() as LaunchRow | undefined;
    if (!row) {
      return null;
    }
    const started = startLaunch(row.id);
    return started;
  });

  return transaction();
}

export function takeNextLaunchToStop(): LaunchRecord | null {
  const transaction = db.transaction(() => {
    const row = selectStoppingLaunchStatement.get() as LaunchRow | undefined;
    if (!row) {
      return null;
    }
    return updateLaunchRecord(row.id, { updatedAt: new Date().toISOString() });
  });

  return transaction();
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
      ingestAttempts: repository.ingestAttempts ?? existing?.ingest_attempts ?? 0,
      launchEnvTemplates: prepareLaunchEnvForUpsert(
        repository.launchEnvTemplates,
        existing?.launch_env_templates ?? null
      )
    };

    insertRepositoryStatement.run(payload);
    if (repository.tags) {
      deleteRepositoryTagsStatement.run(repository.id);
      attachTags(repository.id, repository.tags);
    }
    refreshRepositorySearchIndex(repository.id);
    return rowToRepository(selectRepositoryByIdStatement.get(repository.id) as RepositoryRow);
  });

  const record = transaction();
  notifyRepositoryChanged(record.id);
  return record;
}

export function addRepository(repository: RepositoryInsert): RepositoryRecord {
  const newRepo = {
    ...repository,
    ingestStatus: repository.ingestStatus ?? 'pending',
    updatedAt: repository.updatedAt ?? new Date().toISOString(),
    lastIngestedAt: repository.lastIngestedAt ?? null,
    ingestError: repository.ingestError ?? null,
    ingestAttempts: repository.ingestAttempts ?? 0,
    launchEnvTemplates: prepareLaunchEnvForUpsert(repository.launchEnvTemplates, null)
  };

  const transaction = db.transaction(() => {
    insertRepositoryStatement.run(newRepo);
    if (repository.tags && repository.tags.length > 0) {
      attachTags(repository.id, repository.tags.map((tag) => ({ ...tag, source: tag.source ?? 'author' })));
    }
    refreshRepositorySearchIndex(repository.id);
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
  refreshRepositorySearchIndex(repositoryId);
  notifyRepositoryChanged(repositoryId);
}

export type RepositoryPreviewInput = {
  kind: RepositoryPreviewKind;
  source: string;
  title?: string | null;
  description?: string | null;
  src?: string | null;
  embedUrl?: string | null;
  posterUrl?: string | null;
  width?: number | null;
  height?: number | null;
  sortOrder?: number;
};

export function replaceRepositoryPreviews(repositoryId: string, previews: RepositoryPreviewInput[]) {
  const transaction = db.transaction(() => {
    deleteRepositoryPreviewsStatement.run(repositoryId);
    let order = 0;
    for (const preview of previews) {
      insertRepositoryPreviewStatement.run({
        repositoryId,
        kind: preview.kind,
        source: preview.source,
        title: preview.title ?? null,
        description: preview.description ?? null,
        src: preview.src ?? null,
        embedUrl: preview.embedUrl ?? null,
        posterUrl: preview.posterUrl ?? null,
        width: preview.width ?? null,
        height: preview.height ?? null,
        sortOrder: preview.sortOrder ?? order
      });
      order += 1;
    }
  });
  transaction();
  notifyRepositoryChanged(repositoryId);
}

export function upsertServiceNetwork(input: ServiceNetworkUpsertInput): ServiceNetworkRecord {
  const now = new Date().toISOString();
  const manifestSource = input.manifestSource ?? null;
  const transaction = db.transaction(() => {
    const existing = selectServiceNetworkByIdStatement.get(input.repositoryId) as
      | ServiceNetworkRow
      | undefined;
    const createdAt = existing?.created_at ?? now;
    upsertServiceNetworkStatement.run({
      repositoryId: input.repositoryId,
      manifestSource,
      createdAt,
      updatedAt: now
    });
    const refreshed = selectServiceNetworkByIdStatement.get(input.repositoryId) as
      | ServiceNetworkRow
      | undefined;
    if (!refreshed) {
      return rowToServiceNetwork({
        repository_id: input.repositoryId,
        manifest_source: manifestSource,
        created_at: createdAt,
        updated_at: now
      });
    }
    const memberRows = selectServiceNetworkMembersStatement.all(input.repositoryId) as ServiceNetworkMemberRow[];
    return rowToServiceNetwork(refreshed, memberRows.map(rowToServiceNetworkMember));
  });
  return transaction();
}

export function replaceServiceNetworkMembers(
  networkRepositoryId: string,
  members: ServiceNetworkMemberInput[]
): ServiceNetworkRecord | null {
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    const networkRow = selectServiceNetworkByIdStatement.get(networkRepositoryId) as
      | ServiceNetworkRow
      | undefined;
    if (!networkRow) {
      return null;
    }
    deleteServiceNetworkMembersStatement.run(networkRepositoryId);
    let fallbackOrder = 0;
    for (const member of members) {
      if (!member || typeof member.memberRepositoryId !== 'string') {
        continue;
      }
      const memberId = member.memberRepositoryId.trim().toLowerCase();
      if (!memberId) {
        continue;
      }
      const providedOrder = Number(member.launchOrder);
      const launchOrder = Number.isFinite(providedOrder) && providedOrder >= 0 ? providedOrder : fallbackOrder;
      insertServiceNetworkMemberStatement.run({
        networkRepositoryId,
        memberRepositoryId: memberId,
        launchOrder,
        waitForBuild: member.waitForBuild === false ? 0 : 1,
        envVars: encodeManifestEnv(member.env),
        dependsOn: prepareDependsOn(member.dependsOn),
        createdAt: now,
        updatedAt: now
      });
      fallbackOrder += 1;
    }
    upsertServiceNetworkStatement.run({
      repositoryId: networkRepositoryId,
      manifestSource: networkRow.manifest_source,
      createdAt: networkRow.created_at,
      updatedAt: now
    });
    const refreshedRow = selectServiceNetworkByIdStatement.get(networkRepositoryId) as
      | ServiceNetworkRow
      | undefined;
    if (!refreshedRow) {
      return null;
    }
    const refreshedMembers = selectServiceNetworkMembersStatement.all(networkRepositoryId) as ServiceNetworkMemberRow[];
    return rowToServiceNetwork(refreshedRow, refreshedMembers.map(rowToServiceNetworkMember));
  });
  return transaction();
}

export function getServiceNetworkByRepositoryId(repositoryId: string): ServiceNetworkRecord | null {
  const row = selectServiceNetworkByIdStatement.get(repositoryId) as ServiceNetworkRow | undefined;
  if (!row) {
    return null;
  }
  const memberRows = selectServiceNetworkMembersStatement.all(repositoryId) as ServiceNetworkMemberRow[];
  return rowToServiceNetwork(row, memberRows.map(rowToServiceNetworkMember));
}

export function deleteServiceNetwork(repositoryId: string) {
  const transaction = db.transaction(() => {
    deleteServiceNetworkMembersStatement.run(repositoryId);
    deleteServiceNetworkStatement.run(repositoryId);
  });
  transaction();
}

export function listServiceNetworkRepositoryIds(): string[] {
  const rows = selectAllServiceNetworkIdsStatement.all() as { repository_id: string }[];
  return rows.map((row) => row.repository_id);
}

export function isServiceNetworkRepository(repositoryId: string): boolean {
  const row = selectServiceNetworkByIdStatement.get(repositoryId) as ServiceNetworkRow | undefined;
  return Boolean(row);
}

export function listNetworksForMemberRepository(memberRepositoryId: string): string[] {
  const rows = selectNetworksForMemberStatement.all(memberRepositoryId) as { network_repository_id: string }[];
  return rows.map((row) => row.network_repository_id);
}

export function recordServiceNetworkLaunchMembers(
  networkLaunchId: string,
  members: ServiceNetworkLaunchMemberInput[]
) {
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    deleteServiceNetworkLaunchMembersStatement.run(networkLaunchId);
    for (const member of members) {
      if (!member || typeof member.memberLaunchId !== 'string') {
        continue;
      }
      insertServiceNetworkLaunchMemberStatement.run({
        networkLaunchId,
        memberLaunchId: member.memberLaunchId,
        memberRepositoryId: member.memberRepositoryId,
        launchOrder: member.launchOrder,
        createdAt: now,
        updatedAt: now
      });
    }
  });
  transaction();
}

export function getServiceNetworkLaunchMembers(
  networkLaunchId: string
): ServiceNetworkLaunchMemberRecord[] {
  const rows = selectServiceNetworkLaunchMembersStatement.all(networkLaunchId) as ServiceNetworkLaunchMemberRow[];
  return rows.map(rowToServiceNetworkLaunchMember);
}

export function deleteServiceNetworkLaunchMembers(networkLaunchId: string) {
  deleteServiceNetworkLaunchMembersStatement.run(networkLaunchId);
}

export function updateRepositoryLaunchEnvTemplates(
  repositoryId: string,
  templates: LaunchEnvVar[]
): RepositoryRecord | null {
  const existing = selectRepositoryByIdStatement.get(repositoryId) as RepositoryRow | undefined;
  if (!existing) {
    return null;
  }

  const normalized = normalizeLaunchEnvEntries(templates);
  const encoded = normalized.length > 0 ? JSON.stringify(normalized) : null;

  if (encoded === existing.launch_env_templates) {
    return rowToRepository(existing);
  }

  updateRepositoryEnvTemplatesStatement.run({
    repositoryId,
    launchEnvTemplates: encoded,
    updatedAt: new Date().toISOString()
  });

  notifyRepositoryChanged(repositoryId);
  return getRepositoryById(repositoryId);
}

export function getRepositoryPreviews(repositoryId: string): RepositoryPreview[] {
  const rows = selectRepositoryPreviewsStatement.all(repositoryId) as PreviewRow[];
  return rows.map((row) => rowToPreview(row));
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
    const ingestionEvent = logIngestionEvent({
      repositoryId,
      status,
      message,
      attempt: row.ingest_attempts,
      createdAt: row.updated_at,
      commitSha: extra.commitSha ?? null,
      durationMs: extra.durationMs ?? null
    });
    notifyIngestion(ingestionEvent);
  }

  notifyRepositoryChanged(repositoryId);
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

export function listServices(): ServiceRecord[] {
  const rows = selectServicesStatement.all() as ServiceRow[];
  return rows.map((row) => serviceRowToRecord(row));
}

export function getServiceBySlug(slug: string): ServiceRecord | null {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const row = selectServiceBySlugStatement.get(normalized) as ServiceRow | undefined;
  return row ? serviceRowToRecord(row) : null;
}

export function upsertService(input: ServiceUpsertInput): ServiceRecord {
  const slug = input.slug.trim().toLowerCase();
  if (!slug) {
    throw new Error('Service slug must be provided');
  }
  const baseUrl = input.baseUrl.trim();
  if (!baseUrl) {
    throw new Error('Service baseUrl must be provided');
  }
  const displayName = input.displayName.trim();
  const kind = input.kind.trim() as ServiceKind;
  const now = new Date().toISOString();

  const existingRow = selectServiceBySlugStatement.get(slug) as ServiceRow | undefined;
  const existing = existingRow ? serviceRowToRecord(existingRow) : null;

  const resolvedDisplayName =
    displayName.length > 0 ? displayName : existing?.displayName ?? slug;

  const statusMessage = hasOwn(input, 'statusMessage')
    ? input.statusMessage ?? null
    : existing?.statusMessage ?? null;
  const capabilities = hasOwn(input, 'capabilities')
    ? input.capabilities ?? null
    : existing?.capabilities ?? null;
  const metadata = hasOwn(input, 'metadata')
    ? input.metadata ?? null
    : existing?.metadata ?? null;

  const record: ServiceRecord = {
    id: existing?.id ?? randomUUID(),
    slug,
    displayName: resolvedDisplayName,
    kind,
    baseUrl,
    status: input.status ?? existing?.status ?? 'unknown',
    statusMessage,
    capabilities,
    metadata,
    lastHealthyAt: existing?.lastHealthyAt ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };

  if (existing) {
    const unchanged =
      record.displayName === existing.displayName &&
      record.kind === existing.kind &&
      record.baseUrl === existing.baseUrl &&
      record.status === existing.status &&
      record.statusMessage === existing.statusMessage &&
      record.lastHealthyAt === existing.lastHealthyAt &&
      jsonEquals(record.capabilities, existing.capabilities) &&
      jsonEquals(record.metadata, existing.metadata);
    if (unchanged) {
      return existing;
    }
  }

  const payload = {
    id: record.id,
    slug: record.slug,
    displayName: record.displayName,
    kind: record.kind,
    baseUrl: record.baseUrl,
    status: record.status,
    statusMessage: record.statusMessage ?? null,
    capabilities: serializeJsonColumn(record.capabilities),
    metadata: serializeJsonColumn(record.metadata),
    lastHealthyAt: record.lastHealthyAt ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };

  if (existing) {
    updateServiceStatement.run(payload);
  } else {
    insertServiceStatement.run(payload);
  }

  const updatedRow = selectServiceBySlugStatement.get(slug) as ServiceRow | undefined;
  const updated = updatedRow ? serviceRowToRecord(updatedRow) : record;
  notifyServiceUpdated(updated);
  return updated;
}

export function setServiceStatus(slug: string, update: ServiceStatusUpdate): ServiceRecord | null {
  const normalized = slug.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const existingRow = selectServiceBySlugStatement.get(normalized) as ServiceRow | undefined;
  if (!existingRow) {
    return null;
  }

  const existing = serviceRowToRecord(existingRow);
  const now = new Date().toISOString();
  const baseUrl = update.baseUrl ? update.baseUrl.trim() : existing.baseUrl;
  const nextStatus = update.status ?? existing.status;
  const statusMessage = hasOwn(update, 'statusMessage')
    ? update.statusMessage ?? null
    : existing.statusMessage ?? null;
  const capabilities = hasOwn(update, 'capabilities')
    ? update.capabilities ?? null
    : existing.capabilities ?? null;
  const metadata = hasOwn(update, 'metadata')
    ? update.metadata ?? null
    : existing.metadata ?? null;
  let lastHealthyAt = existing.lastHealthyAt;
  if (update.lastHealthyAt !== undefined) {
    lastHealthyAt = update.lastHealthyAt;
  } else if (nextStatus === 'healthy' && existing.status !== 'healthy') {
    lastHealthyAt = now;
  }

  const record: ServiceRecord = {
    ...existing,
    baseUrl,
    status: nextStatus,
    statusMessage,
    capabilities,
    metadata,
    lastHealthyAt,
    updatedAt: now
  };

  const unchanged =
    record.status === existing.status &&
    record.statusMessage === existing.statusMessage &&
    record.baseUrl === existing.baseUrl &&
    record.lastHealthyAt === existing.lastHealthyAt &&
    jsonEquals(record.capabilities, existing.capabilities) &&
    jsonEquals(record.metadata, existing.metadata);

  if (unchanged) {
    return existing;
  }

  const payload = {
    id: record.id,
    slug: record.slug,
    displayName: record.displayName,
    kind: record.kind,
    baseUrl: record.baseUrl,
    status: record.status,
    statusMessage: record.statusMessage ?? null,
    capabilities: serializeJsonColumn(record.capabilities),
    metadata: serializeJsonColumn(record.metadata),
    lastHealthyAt: record.lastHealthyAt ?? null,
    updatedAt: record.updatedAt
  };

  updateServiceStatement.run(payload);

  const updatedRow = selectServiceBySlugStatement.get(normalized) as ServiceRow | undefined;
  const updated = updatedRow ? serviceRowToRecord(updatedRow) : record;
  notifyServiceUpdated(updated);
  return updated;
}
