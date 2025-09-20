import type { PoolClient } from 'pg';

type Migration = {
  id: string;
  statements: string[];
};

const migrations: Migration[] = [
  {
    id: '001_initial_postgres_schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS repositories (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL,
         description TEXT NOT NULL,
         repo_url TEXT NOT NULL,
         dockerfile_path TEXT NOT NULL,
         ingest_status TEXT NOT NULL DEFAULT 'seed',
         updated_at TIMESTAMPTZ NOT NULL,
         last_ingested_at TIMESTAMPTZ,
         ingest_error TEXT,
         ingest_attempts INTEGER NOT NULL DEFAULT 0,
         launch_env_templates JSONB DEFAULT '[]'::jsonb,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE TABLE IF NOT EXISTS tags (
         id BIGSERIAL PRIMARY KEY,
         key TEXT NOT NULL,
         value TEXT NOT NULL,
         description TEXT,
         UNIQUE (key, value)
       );`,
      `CREATE TABLE IF NOT EXISTS repository_tags (
         repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
         tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
         source TEXT NOT NULL DEFAULT 'seed',
         PRIMARY KEY (repository_id, tag_id)
       );`,
      `CREATE TABLE IF NOT EXISTS ingestion_events (
         id BIGSERIAL PRIMARY KEY,
         repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
         status TEXT NOT NULL,
         message TEXT,
         attempt INTEGER,
         commit_sha TEXT,
         duration_ms INTEGER,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_ingestion_events_repo_created
         ON ingestion_events(repository_id, created_at DESC);`,
      `CREATE TABLE IF NOT EXISTS builds (
         id TEXT PRIMARY KEY,
         repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
         status TEXT NOT NULL,
         logs TEXT,
         image_tag TEXT,
         error_message TEXT,
         commit_sha TEXT,
         branch TEXT,
         git_ref TEXT,
         created_at TIMESTAMPTZ NOT NULL,
         updated_at TIMESTAMPTZ NOT NULL,
         started_at TIMESTAMPTZ,
         completed_at TIMESTAMPTZ,
         duration_ms INTEGER
       );`,
      `CREATE INDEX IF NOT EXISTS idx_builds_repo_created ON builds(repository_id, created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_builds_status ON builds(status);`,
      `CREATE TABLE IF NOT EXISTS launches (
         id TEXT PRIMARY KEY,
         repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
         build_id TEXT NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
         status TEXT NOT NULL DEFAULT 'pending',
         instance_url TEXT,
         container_id TEXT,
         port INTEGER,
         resource_profile TEXT,
         command TEXT,
         env_vars JSONB DEFAULT '[]'::jsonb,
         error_message TEXT,
         created_at TIMESTAMPTZ NOT NULL,
         updated_at TIMESTAMPTZ NOT NULL,
         started_at TIMESTAMPTZ,
         stopped_at TIMESTAMPTZ,
         expires_at TIMESTAMPTZ
       );`,
      `CREATE INDEX IF NOT EXISTS idx_launches_repo_created ON launches(repository_id, created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_launches_status ON launches(status);`,
      `CREATE TABLE IF NOT EXISTS service_networks (
         repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
         manifest_source TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE TABLE IF NOT EXISTS service_network_members (
         network_repository_id TEXT NOT NULL REFERENCES service_networks(repository_id) ON DELETE CASCADE,
         member_repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
         launch_order INTEGER NOT NULL DEFAULT 0,
         wait_for_build BOOLEAN NOT NULL DEFAULT TRUE,
         env_vars JSONB DEFAULT '[]'::jsonb,
         depends_on JSONB DEFAULT '[]'::jsonb,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         PRIMARY KEY (network_repository_id, member_repository_id)
       );`,
      `CREATE TABLE IF NOT EXISTS service_network_launch_members (
         network_launch_id TEXT NOT NULL REFERENCES launches(id) ON DELETE CASCADE,
         member_launch_id TEXT NOT NULL REFERENCES launches(id) ON DELETE CASCADE,
         member_repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
         launch_order INTEGER NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         PRIMARY KEY (network_launch_id, member_repository_id)
       );`,
      `CREATE TABLE IF NOT EXISTS repository_previews (
         id BIGSERIAL PRIMARY KEY,
         repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
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
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_repository_previews_repo_sort
         ON repository_previews(repository_id, sort_order);`,
      `CREATE TABLE IF NOT EXISTS services (
         id TEXT PRIMARY KEY,
         slug TEXT NOT NULL UNIQUE,
         display_name TEXT NOT NULL,
         kind TEXT NOT NULL,
         base_url TEXT NOT NULL,
         status TEXT NOT NULL DEFAULT 'unknown',
         status_message TEXT,
         capabilities JSONB,
         metadata JSONB,
         last_healthy_at TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_services_kind ON services(kind);`,
      `CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);`,
      `CREATE TABLE IF NOT EXISTS repository_search (
         repository_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
         document TSVECTOR NOT NULL,
         name TEXT NOT NULL,
         description TEXT NOT NULL,
         repo_url TEXT NOT NULL,
         tag_text TEXT NOT NULL,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_repository_search_document
         ON repository_search USING GIN(document);`
    ]
  }
];

export async function runMigrations(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const { rows } = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.id));

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    await client.query('BEGIN');
    try {
      for (const statement of migration.statements) {
        await client.query(statement);
      }
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [migration.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
}
