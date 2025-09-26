import type { PoolClient } from 'pg';
import { withConnection } from './client';

interface Migration {
  id: string;
  statements: string[];
}

const migrations: Migration[] = [
  {
    id: '001_timestore_core_schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS storage_targets (
         id TEXT PRIMARY KEY,
         name TEXT NOT NULL UNIQUE,
         kind TEXT NOT NULL,
         description TEXT,
         config JSONB NOT NULL DEFAULT '{}'::jsonb,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         CHECK (kind IN ('local', 's3', 'gcs', 'azure_blob'))
       );`,
      `CREATE INDEX IF NOT EXISTS idx_storage_targets_kind
         ON storage_targets(kind);`,
      `CREATE TABLE IF NOT EXISTS datasets (
         id TEXT PRIMARY KEY,
         slug TEXT NOT NULL UNIQUE,
         name TEXT NOT NULL,
         description TEXT,
         status TEXT NOT NULL DEFAULT 'active',
         write_format TEXT NOT NULL DEFAULT 'duckdb',
         default_storage_target_id TEXT REFERENCES storage_targets(id),
         metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         CHECK (status IN ('active', 'inactive')),
         CHECK (write_format IN ('duckdb', 'parquet'))
       );`,
      `CREATE INDEX IF NOT EXISTS idx_datasets_status ON datasets(status);`,
      `CREATE INDEX IF NOT EXISTS idx_datasets_storage_target
         ON datasets(default_storage_target_id)
         WHERE default_storage_target_id IS NOT NULL;`,
      `CREATE TABLE IF NOT EXISTS dataset_schema_versions (
         id TEXT PRIMARY KEY,
         dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
         version INTEGER NOT NULL,
         description TEXT,
         schema JSONB NOT NULL,
         checksum TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         UNIQUE (dataset_id, version),
         CHECK (version > 0)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_dataset_schema_versions_dataset
         ON dataset_schema_versions(dataset_id);`,
      `CREATE TABLE IF NOT EXISTS dataset_manifests (
         id TEXT PRIMARY KEY,
         dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
         version INTEGER NOT NULL,
         status TEXT NOT NULL DEFAULT 'draft',
         schema_version_id TEXT REFERENCES dataset_schema_versions(id) ON DELETE SET NULL,
         parent_manifest_id TEXT REFERENCES dataset_manifests(id) ON DELETE SET NULL,
         summary JSONB NOT NULL DEFAULT '{}'::jsonb,
         statistics JSONB NOT NULL DEFAULT '{}'::jsonb,
         metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
         partition_count INTEGER NOT NULL DEFAULT 0,
         total_rows BIGINT NOT NULL DEFAULT 0,
         total_bytes BIGINT NOT NULL DEFAULT 0,
         created_by TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         published_at TIMESTAMPTZ,
         UNIQUE (dataset_id, version),
         CHECK (version > 0),
         CHECK (status IN ('draft', 'published', 'superseded'))
       );`,
      `CREATE INDEX IF NOT EXISTS idx_dataset_manifests_dataset
         ON dataset_manifests(dataset_id, version DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_dataset_manifests_status
         ON dataset_manifests(dataset_id, status);`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_dataset_manifests_published
         ON dataset_manifests(dataset_id)
         WHERE status = 'published';`,
      `CREATE TABLE IF NOT EXISTS dataset_partitions (
         id TEXT PRIMARY KEY,
         dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
         manifest_id TEXT NOT NULL REFERENCES dataset_manifests(id) ON DELETE CASCADE,
         partition_key JSONB NOT NULL,
         storage_target_id TEXT NOT NULL REFERENCES storage_targets(id),
         file_format TEXT NOT NULL,
         file_path TEXT NOT NULL,
         file_size_bytes BIGINT,
         row_count BIGINT,
         start_time TIMESTAMPTZ NOT NULL,
         end_time TIMESTAMPTZ NOT NULL,
         checksum TEXT,
         metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         CHECK (file_format IN ('duckdb', 'parquet')),
         CHECK (end_time >= start_time)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_dataset_partitions_time
         ON dataset_partitions(dataset_id, start_time, end_time);`,
      `CREATE INDEX IF NOT EXISTS idx_dataset_partitions_manifest
         ON dataset_partitions(manifest_id);`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_dataset_partitions_path
         ON dataset_partitions(dataset_id, storage_target_id, file_path);`,
      `CREATE TABLE IF NOT EXISTS dataset_retention_policies (
         dataset_id TEXT PRIMARY KEY REFERENCES datasets(id) ON DELETE CASCADE,
         policy JSONB NOT NULL,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`
    ]
  },
  {
    id: '002_timestore_ingestion_batches',
    statements: [
      `CREATE TABLE IF NOT EXISTS ingestion_batches (
         id TEXT PRIMARY KEY,
         dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
         idempotency_key TEXT NOT NULL,
         manifest_id TEXT NOT NULL REFERENCES dataset_manifests(id) ON DELETE CASCADE,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         UNIQUE (dataset_id, idempotency_key)
       );`
    ]
  },
  {
    id: '003_timestore_lifecycle_maintenance',
    statements: [
      `CREATE TABLE IF NOT EXISTS lifecycle_job_runs (
         id TEXT PRIMARY KEY,
         job_kind TEXT NOT NULL,
         dataset_id TEXT REFERENCES datasets(id) ON DELETE SET NULL,
         operations TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
         trigger_source TEXT NOT NULL,
         status TEXT NOT NULL,
         scheduled_for TIMESTAMPTZ,
         started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         completed_at TIMESTAMPTZ,
         duration_ms INTEGER,
         attempts INTEGER NOT NULL DEFAULT 0,
         error TEXT,
         metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         CHECK (status IN ('queued', 'running', 'completed', 'failed', 'skipped'))
       );`,
      `CREATE INDEX IF NOT EXISTS idx_lifecycle_job_runs_dataset
         ON lifecycle_job_runs(dataset_id, created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_lifecycle_job_runs_status
         ON lifecycle_job_runs(status, created_at DESC);`,
      `CREATE TABLE IF NOT EXISTS lifecycle_audit_log (
         id TEXT PRIMARY KEY,
         dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
         manifest_id TEXT REFERENCES dataset_manifests(id) ON DELETE SET NULL,
         event_type TEXT NOT NULL,
         payload JSONB NOT NULL DEFAULT '{}'::jsonb,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_lifecycle_audit_dataset
         ON lifecycle_audit_log(dataset_id, created_at DESC);`
    ]
  },
  {
    id: '004_timestore_dataset_access_audit',
    statements: [
      `CREATE TABLE IF NOT EXISTS dataset_access_audit (
        id TEXT PRIMARY KEY,
         dataset_id TEXT REFERENCES datasets(id) ON DELETE SET NULL,
         dataset_slug TEXT NOT NULL,
         actor_id TEXT,
         actor_scopes TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
         action TEXT NOT NULL,
         success BOOLEAN NOT NULL,
         metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_dataset_access_audit_dataset
         ON dataset_access_audit(dataset_id, created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_dataset_access_audit_slug
        ON dataset_access_audit(dataset_slug, created_at DESC);`
    ]
  },
  {
    id: '005_timestore_filestore_activity_state',
    statements: [
      `CREATE TABLE IF NOT EXISTS filestore_node_state (
         node_id BIGINT PRIMARY KEY,
         backend_mount_id BIGINT,
         path TEXT,
         state TEXT,
         consistency_state TEXT,
         size_bytes BIGINT,
         last_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         last_journal_id BIGINT,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_filestore_node_state_backend
         ON filestore_node_state(backend_mount_id);`
    ]
  }
];

export async function runMigrations(): Promise<void> {
  await withConnection(async (client) => {
    await ensureSchemaMigrationsTable(client);

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
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING', [migration.id]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  });
}

async function ensureSchemaMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
