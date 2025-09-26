import type { PoolClient } from 'pg';
import { withConnection } from './client';

interface Migration {
  id: string;
  statements: string[];
}

const MIGRATION_TABLE = 'filestore_schema_migrations';

const migrations: Migration[] = [
  {
    id: '001_filestore_core_schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS backend_mounts (
         id BIGSERIAL PRIMARY KEY,
         mount_key TEXT NOT NULL UNIQUE,
         backend_kind TEXT NOT NULL,
         root_path TEXT,
         bucket TEXT,
         prefix TEXT,
         config JSONB NOT NULL DEFAULT '{}'::jsonb,
         access_mode TEXT NOT NULL DEFAULT 'rw',
         state TEXT NOT NULL DEFAULT 'active',
         last_health_check_at TIMESTAMPTZ,
         last_health_status TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         CHECK (backend_kind IN ('local', 's3')),
         CHECK (access_mode IN ('rw', 'ro')),
         CHECK (backend_kind <> 'local' OR root_path IS NOT NULL),
         CHECK (backend_kind <> 's3' OR bucket IS NOT NULL)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_backend_mounts_kind
         ON backend_mounts(backend_kind);`,
      `CREATE INDEX IF NOT EXISTS idx_backend_mounts_state
         ON backend_mounts(state);`,
      `CREATE TABLE IF NOT EXISTS nodes (
         id BIGSERIAL PRIMARY KEY,
         backend_mount_id BIGINT NOT NULL REFERENCES backend_mounts(id) ON DELETE CASCADE,
         parent_id BIGINT REFERENCES nodes(id) ON DELETE CASCADE,
         path TEXT NOT NULL,
         name TEXT NOT NULL,
         depth INTEGER NOT NULL DEFAULT 0,
         kind TEXT NOT NULL,
         size_bytes BIGINT NOT NULL DEFAULT 0,
         checksum TEXT,
         content_hash TEXT,
         storage_class TEXT,
         metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
         state TEXT NOT NULL DEFAULT 'active',
         version INTEGER NOT NULL DEFAULT 1,
         is_symlink BOOLEAN NOT NULL DEFAULT false,
         last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         last_modified_at TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         deleted_at TIMESTAMPTZ,
         UNIQUE (backend_mount_id, path),
         CHECK (kind IN ('file', 'directory')),
         CHECK (state IN ('active', 'inconsistent', 'missing', 'deleted')),
         CHECK (depth >= 0)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_backend_parent
         ON nodes(backend_mount_id, parent_id);`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_parent
         ON nodes(parent_id);`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_state
         ON nodes(state);`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_checksum
         ON nodes(backend_mount_id, checksum)
         WHERE checksum IS NOT NULL;`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_metadata
         ON nodes USING GIN (metadata);`,
      `CREATE TABLE IF NOT EXISTS snapshots (
         id BIGSERIAL PRIMARY KEY,
         node_id BIGINT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
         version INTEGER NOT NULL,
         captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         state TEXT NOT NULL,
         size_bytes BIGINT,
         checksum TEXT,
         content_hash TEXT,
         path TEXT NOT NULL,
         metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         UNIQUE (node_id, version),
         CHECK (state IN ('active', 'inconsistent', 'missing', 'deleted'))
       );`,
      `CREATE INDEX IF NOT EXISTS idx_snapshots_node_version
         ON snapshots(node_id, version DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_snapshots_captured
         ON snapshots(captured_at DESC);`,
      `CREATE TABLE IF NOT EXISTS journal_entries (
         id BIGSERIAL PRIMARY KEY,
         command TEXT NOT NULL,
         status TEXT NOT NULL,
         executor_kind TEXT NOT NULL,
         principal TEXT,
         request_id TEXT,
         idempotency_key TEXT,
         correlation_id TEXT,
         primary_node_id BIGINT REFERENCES nodes(id) ON DELETE SET NULL,
         secondary_node_id BIGINT REFERENCES nodes(id) ON DELETE SET NULL,
         affected_node_ids BIGINT[] NOT NULL DEFAULT '{}'::BIGINT[],
         parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
         result JSONB,
         error JSONB,
         started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         completed_at TIMESTAMPTZ,
         duration_ms INTEGER,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
         CHECK (duration_ms IS NULL OR duration_ms >= 0)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_journal_created
         ON journal_entries(created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_journal_status
         ON journal_entries(status, created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_journal_primary_node
         ON journal_entries(primary_node_id, created_at DESC);`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_idempotency
         ON journal_entries(command, idempotency_key)
         WHERE idempotency_key IS NOT NULL;`,
      `CREATE TABLE IF NOT EXISTS rollups (
         node_id BIGINT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
         size_bytes BIGINT NOT NULL DEFAULT 0,
         file_count BIGINT NOT NULL DEFAULT 0,
         directory_count BIGINT NOT NULL DEFAULT 0,
         child_count BIGINT NOT NULL DEFAULT 0,
         pending_bytes_delta BIGINT NOT NULL DEFAULT 0,
         pending_items_delta BIGINT NOT NULL DEFAULT 0,
         state TEXT NOT NULL DEFAULT 'up_to_date',
         last_calculated_at TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         CHECK (state IN ('up_to_date', 'pending', 'stale', 'invalid'))
       );`,
      `CREATE INDEX IF NOT EXISTS idx_rollups_state
         ON rollups(state);`,
      `CREATE INDEX IF NOT EXISTS idx_rollups_pending
         ON rollups(pending_bytes_delta, pending_items_delta);`,
      `CREATE OR REPLACE VIEW view_filestore_active_nodes AS
         SELECT *
           FROM nodes
          WHERE deleted_at IS NULL
            AND state <> 'deleted';`,
      `CREATE OR REPLACE FUNCTION filestore_touch_updated_at()
         RETURNS TRIGGER
         LANGUAGE plpgsql
         AS $$
       BEGIN
         NEW.updated_at = NOW();
         RETURN NEW;
       END;
       $$;`,
      `CREATE OR REPLACE FUNCTION filestore_bump_node_version()
         RETURNS TRIGGER
         LANGUAGE plpgsql
         AS $$
       BEGIN
         NEW.updated_at = NOW();
         NEW.version = COALESCE(OLD.version, 0) + 1;
         IF NEW.state = 'deleted' THEN
           NEW.deleted_at = COALESCE(NEW.deleted_at, NOW());
         ELSE
           NEW.deleted_at = CASE
             WHEN NEW.state = 'missing' THEN NEW.deleted_at
             ELSE NULL
           END;
         END IF;
         RETURN NEW;
       END;
       $$;`,
      `CREATE TRIGGER trg_backend_mounts_touch_updated_at
         BEFORE UPDATE ON backend_mounts
         FOR EACH ROW
         EXECUTE FUNCTION filestore_touch_updated_at();`,
      `CREATE TRIGGER trg_nodes_bump_version
         BEFORE UPDATE ON nodes
         FOR EACH ROW
         EXECUTE FUNCTION filestore_bump_node_version();`,
      `CREATE TRIGGER trg_rollups_touch_updated_at
         BEFORE UPDATE ON rollups
         FOR EACH ROW
         EXECUTE FUNCTION filestore_touch_updated_at();`
    ]
  },
  {
    id: '002_filestore_reconciliation_columns',
    statements: [
      `ALTER TABLE nodes
         ADD COLUMN IF NOT EXISTS consistency_state TEXT NOT NULL DEFAULT 'active';`,
      `ALTER TABLE nodes
         ADD COLUMN IF NOT EXISTS consistency_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`,
      `ALTER TABLE nodes
         ADD COLUMN IF NOT EXISTS last_reconciled_at TIMESTAMPTZ;`,
      `ALTER TABLE nodes
         ADD COLUMN IF NOT EXISTS last_drift_detected_at TIMESTAMPTZ;`,
      `ALTER TABLE nodes
         ADD CONSTRAINT chk_nodes_consistency_state
           CHECK (consistency_state IN ('active', 'inconsistent', 'missing'));`,
      `UPDATE nodes
          SET consistency_state = CASE
                WHEN state IN ('active', 'inconsistent', 'missing') THEN state
                ELSE 'active'
              END,
              consistency_checked_at = COALESCE(consistency_checked_at, NOW()),
              last_reconciled_at = CASE
                WHEN state = 'active' THEN COALESCE(last_reconciled_at, NOW())
                ELSE last_reconciled_at
              END;`,
      `CREATE INDEX IF NOT EXISTS idx_nodes_consistency_state
         ON nodes(consistency_state);`
    ]
  }
];

export async function runMigrations(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const { rows } = await client.query<{ id: string }>(`SELECT id FROM ${MIGRATION_TABLE}`);
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
      await client.query(`INSERT INTO ${MIGRATION_TABLE} (id) VALUES ($1) ON CONFLICT DO NOTHING`, [
        migration.id
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
}

export async function runMigrationsWithConnection(): Promise<void> {
  await withConnection(async (client) => {
    await runMigrations(client);
  });
}
