import type { PoolClient } from 'pg';

type Migration = {
  id: string;
  statements: string[];
};

const MIGRATION_TABLE = 'metastore_schema_migrations';

const migrations: Migration[] = [
  {
    id: '001_metastore_initial_schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS metastore_records (
         id BIGSERIAL PRIMARY KEY,
         namespace TEXT NOT NULL,
         record_key TEXT NOT NULL,
         metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
         tags TEXT[] NOT NULL DEFAULT '{}'::text[],
         owner TEXT,
         schema_hash TEXT,
         version INTEGER NOT NULL DEFAULT 1,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         deleted_at TIMESTAMPTZ,
         created_by TEXT,
         updated_by TEXT,
         UNIQUE (namespace, record_key)
       );`,
      `CREATE TABLE IF NOT EXISTS metastore_record_audits (
         id BIGSERIAL PRIMARY KEY,
         record_id BIGINT,
         namespace TEXT NOT NULL,
         record_key TEXT NOT NULL,
         action TEXT NOT NULL,
         actor TEXT,
         previous_version INTEGER,
         version INTEGER,
         metadata JSONB,
         previous_metadata JSONB,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_metastore_records_namespace_key
         ON metastore_records(namespace, record_key);`,
      `CREATE INDEX IF NOT EXISTS idx_metastore_records_namespace_updated
         ON metastore_records(namespace, updated_at DESC)
         WHERE deleted_at IS NULL;`,
      `CREATE INDEX IF NOT EXISTS idx_metastore_records_owner
         ON metastore_records(owner)
         WHERE owner IS NOT NULL;`,
      `CREATE INDEX IF NOT EXISTS idx_metastore_records_schema_hash
         ON metastore_records(schema_hash)
         WHERE schema_hash IS NOT NULL;`,
      `CREATE INDEX IF NOT EXISTS idx_metastore_records_tags
         ON metastore_records USING GIN (tags);`,
      `CREATE INDEX IF NOT EXISTS idx_metastore_records_metadata
         ON metastore_records USING GIN (metadata);`,
      `CREATE INDEX IF NOT EXISTS idx_metastore_record_audits_record
         ON metastore_record_audits(namespace, record_key, created_at DESC);`
    ]
  },
  {
    id: '002_metastore_audit_enrichment',
    statements: [
      `ALTER TABLE metastore_record_audits ADD COLUMN IF NOT EXISTS tags TEXT[];`,
      `ALTER TABLE metastore_record_audits ADD COLUMN IF NOT EXISTS previous_tags TEXT[];`,
      `ALTER TABLE metastore_record_audits ADD COLUMN IF NOT EXISTS owner TEXT;`,
      `ALTER TABLE metastore_record_audits ADD COLUMN IF NOT EXISTS previous_owner TEXT;`,
      `ALTER TABLE metastore_record_audits ADD COLUMN IF NOT EXISTS schema_hash TEXT;`,
      `ALTER TABLE metastore_record_audits ADD COLUMN IF NOT EXISTS previous_schema_hash TEXT;`
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
