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
  },
  {
    id: '002_jobs_schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS job_definitions (
         id TEXT PRIMARY KEY,
         slug TEXT NOT NULL UNIQUE,
         name TEXT NOT NULL,
         version INTEGER NOT NULL DEFAULT 1,
         type TEXT NOT NULL,
         entry_point TEXT NOT NULL,
         parameters_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
         default_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
         timeout_ms INTEGER,
         retry_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
         metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE TABLE IF NOT EXISTS job_runs (
         id TEXT PRIMARY KEY,
         job_definition_id TEXT NOT NULL REFERENCES job_definitions(id) ON DELETE CASCADE,
         status TEXT NOT NULL,
         parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
         result JSONB,
         error_message TEXT,
         logs_url TEXT,
         metrics JSONB,
         context JSONB,
         timeout_ms INTEGER,
         attempt INTEGER NOT NULL DEFAULT 1,
         max_attempts INTEGER,
         duration_ms INTEGER,
         scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         started_at TIMESTAMPTZ,
         completed_at TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_job_definitions_slug ON job_definitions(slug);`,
      `CREATE INDEX IF NOT EXISTS idx_job_runs_definition_status ON job_runs(job_definition_id, status);`,
      `CREATE INDEX IF NOT EXISTS idx_job_runs_status ON job_runs(status);`,
      `CREATE INDEX IF NOT EXISTS idx_job_runs_created_at ON job_runs(created_at DESC);`,
      `INSERT INTO job_definitions (
         id,
         slug,
         name,
         version,
         type,
         entry_point,
         parameters_schema,
         default_parameters,
         timeout_ms,
         retry_policy,
         metadata
       ) VALUES
        (
          'jobdef-repository-ingest',
          'repository-ingest',
          'Repository Ingestion',
          1,
          'batch',
          'catalog.ingestion.processRepository',
          '{"type":"object","properties":{"repositoryId":{"type":"string","minLength":1}},"required":["repositoryId"]}'::jsonb,
          '{"repositoryId":null}'::jsonb,
          900000,
          '{"maxAttempts":3,"strategy":"exponential","initialDelayMs":10000}'::jsonb,
          '{"description":"Default ingestion job for repositories"}'::jsonb
        ),
        (
          'jobdef-repository-build',
          'repository-build',
          'Repository Build',
          1,
          'batch',
          'catalog.build.run',
          '{"type":"object","properties":{"buildId":{"type":"string","minLength":1}},"required":["buildId"]}'::jsonb,
          '{"buildId":null}'::jsonb,
          1800000,
          '{"maxAttempts":1}'::jsonb,
          '{"description":"Default build job for repositories"}'::jsonb
        )
      ON CONFLICT (slug) DO UPDATE
      SET
        name = EXCLUDED.name,
        version = EXCLUDED.version,
        type = EXCLUDED.type,
         entry_point = EXCLUDED.entry_point,
         parameters_schema = EXCLUDED.parameters_schema,
         default_parameters = EXCLUDED.default_parameters,
         timeout_ms = EXCLUDED.timeout_ms,
         retry_policy = EXCLUDED.retry_policy,
         metadata = EXCLUDED.metadata,
       updated_at = NOW();`
    ]
  },
  {
    id: '003_workflows_schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS workflow_definitions (
         id TEXT PRIMARY KEY,
         slug TEXT NOT NULL UNIQUE,
         name TEXT NOT NULL,
         version INTEGER NOT NULL DEFAULT 1,
         description TEXT,
         steps JSONB NOT NULL DEFAULT '[]'::jsonb,
         triggers JSONB NOT NULL DEFAULT '[]'::jsonb,
         parameters_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
         default_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
         metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE TABLE IF NOT EXISTS workflow_runs (
         id TEXT PRIMARY KEY,
         workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
         status TEXT NOT NULL,
         parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
         context JSONB NOT NULL DEFAULT '{}'::jsonb,
         error_message TEXT,
         current_step_id TEXT,
         current_step_index INTEGER,
         metrics JSONB,
         triggered_by TEXT,
         trigger JSONB,
         started_at TIMESTAMPTZ,
         completed_at TIMESTAMPTZ,
         duration_ms INTEGER,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE TABLE IF NOT EXISTS workflow_run_steps (
         id TEXT PRIMARY KEY,
         workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
         step_id TEXT NOT NULL,
         status TEXT NOT NULL,
         attempt INTEGER NOT NULL DEFAULT 1,
         job_run_id TEXT REFERENCES job_runs(id) ON DELETE SET NULL,
         input JSONB,
         output JSONB,
         error_message TEXT,
         logs_url TEXT,
         metrics JSONB,
         context JSONB,
         started_at TIMESTAMPTZ,
         completed_at TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_definitions_slug ON workflow_definitions(slug);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_runs_definition_created ON workflow_runs(workflow_definition_id, created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_run_created ON workflow_run_steps(workflow_run_id, created_at);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_job_run ON workflow_run_steps(job_run_id) WHERE job_run_id IS NOT NULL;`
    ]
  },
  {
    id: '004_security_observability',
    statements: [
      `CREATE TABLE IF NOT EXISTS audit_logs (
         id BIGSERIAL PRIMARY KEY,
         actor TEXT,
         actor_type TEXT,
         token_hash TEXT,
         scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
         action TEXT NOT NULL,
         resource TEXT NOT NULL,
         status TEXT NOT NULL,
         ip TEXT,
         user_agent TEXT,
         metadata JSONB,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_created
         ON audit_logs(resource, created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
         ON audit_logs(action, created_at DESC);`
    ]
  },
  {
    id: '005_workflow_filesystem_jobs',
    statements: [
      `INSERT INTO job_definitions (
         id,
         slug,
         name,
         version,
         type,
         entry_point,
         parameters_schema,
         default_parameters,
         timeout_ms,
         retry_policy,
         metadata
       ) VALUES
         (
           'jobdef-fs-read-file',
           'fs-read-file',
           'Filesystem Read File',
           1,
           'batch',
           'workflows.fs.readFile',
           '{"type":"object","properties":{"hostPath":{"type":"string","minLength":1},"encoding":{"type":"string","minLength":1}},"required":["hostPath"]}'::jsonb,
           '{"encoding":"utf8"}'::jsonb,
           60000,
           '{"maxAttempts":1}'::jsonb,
           '{"description":"Reads a file from the host filesystem and returns its contents."}'::jsonb
         ),
         (
           'jobdef-fs-write-file',
           'fs-write-file',
           'Filesystem Write File',
           1,
           'batch',
           'workflows.fs.writeFile',
           '{"type":"object","properties":{"sourcePath":{"type":"string","minLength":1},"content":{"type":"string"},"outputPath":{"type":"string","minLength":1},"outputFilename":{"type":"string","minLength":1},"encoding":{"type":"string","minLength":1},"overwrite":{"type":"boolean"}},"required":["sourcePath","content"]}'::jsonb,
           '{"encoding":"utf8","overwrite":true}'::jsonb,
           60000,
           '{"maxAttempts":1}'::jsonb,
           '{"description":"Writes summary content next to a host filesystem file."}'::jsonb
         )
       ON CONFLICT (slug) DO UPDATE
       SET
         name = EXCLUDED.name,
         version = EXCLUDED.version,
         type = EXCLUDED.type,
         entry_point = EXCLUDED.entry_point,
         parameters_schema = EXCLUDED.parameters_schema,
         default_parameters = EXCLUDED.default_parameters,
         timeout_ms = EXCLUDED.timeout_ms,
         retry_policy = EXCLUDED.retry_policy,
         metadata = EXCLUDED.metadata,
         updated_at = NOW();`
    ]
  },
  {
    id: '006_job_registry_schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS job_bundles (
         id TEXT PRIMARY KEY,
         slug TEXT NOT NULL UNIQUE,
         display_name TEXT NOT NULL,
         description TEXT,
         latest_version TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE TABLE IF NOT EXISTS job_bundle_versions (
         id TEXT PRIMARY KEY,
         bundle_id TEXT NOT NULL REFERENCES job_bundles(id) ON DELETE CASCADE,
         slug TEXT NOT NULL REFERENCES job_bundles(slug) ON DELETE CASCADE,
         version TEXT NOT NULL,
         manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
         checksum TEXT NOT NULL,
         capability_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
         artifact_storage TEXT NOT NULL DEFAULT 'local',
         artifact_path TEXT NOT NULL,
         artifact_content_type TEXT,
         artifact_size BIGINT,
         immutable BOOLEAN NOT NULL DEFAULT FALSE,
         status TEXT NOT NULL DEFAULT 'published',
         published_by TEXT,
         published_by_kind TEXT,
         published_by_token_hash TEXT,
         published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         deprecated_at TIMESTAMPTZ,
         metadata JSONB,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         UNIQUE (bundle_id, version),
         CONSTRAINT job_bundle_versions_status_check CHECK (status IN ('published', 'deprecated')),
         CONSTRAINT job_bundle_versions_storage_check CHECK (artifact_storage IN ('local', 's3'))
       );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_job_bundle_versions_slug_version
         ON job_bundle_versions(slug, version);`,
      `CREATE INDEX IF NOT EXISTS idx_job_bundle_versions_status
         ON job_bundle_versions(bundle_id, status);`,
      `CREATE INDEX IF NOT EXISTS idx_job_bundle_versions_published_at
         ON job_bundle_versions(bundle_id, published_at DESC);`
    ]
  },
  {
    id: '007_filesystem_job_bundles',
    statements: [
      `UPDATE job_definitions
         SET entry_point = 'bundle:fs-read-file@1.0.0',
             metadata = jsonb_set(
               jsonb_set(coalesce(metadata, '{}'::jsonb), '{registryRef}', to_jsonb('fs-read-file@1.0.0'::text), true),
               '{legacyHandler}',
               to_jsonb('workflows.fs.readFile'::text),
               true
             )
       WHERE slug = 'fs-read-file';`,
      `UPDATE job_definitions
         SET entry_point = 'bundle:fs-write-file@1.0.0',
             metadata = jsonb_set(
               jsonb_set(coalesce(metadata, '{}'::jsonb), '{registryRef}', to_jsonb('fs-write-file@1.0.0'::text), true),
               '{legacyHandler}',
               to_jsonb('workflows.fs.writeFile'::text),
               true
             )
      WHERE slug = 'fs-write-file';`
    ]
  },
  {
    id: '008_launch_network_metadata',
    statements: [
      `ALTER TABLE launches
         ADD COLUMN IF NOT EXISTS internal_port INTEGER`,
      `ALTER TABLE launches
         ADD COLUMN IF NOT EXISTS container_ip TEXT`
    ]
  },
  {
    id: '009_workflow_dag_metadata',
    statements: [
      `ALTER TABLE workflow_definitions
         ADD COLUMN IF NOT EXISTS dag JSONB NOT NULL DEFAULT '{}'::jsonb`
    ]
  },
  {
    id: '010_workflow_fanout_metadata',
    statements: [
      `ALTER TABLE workflow_run_steps
         ADD COLUMN IF NOT EXISTS parent_step_id TEXT`,
      `ALTER TABLE workflow_run_steps
         ADD COLUMN IF NOT EXISTS fanout_index INTEGER`,
      `ALTER TABLE workflow_run_steps
         ADD COLUMN IF NOT EXISTS template_step_id TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_parent
         ON workflow_run_steps(parent_step_id)
         WHERE parent_step_id IS NOT NULL`
    ]
  },
  {
    id: '011_output_schemas',
    statements: [
      `ALTER TABLE job_definitions
         ADD COLUMN IF NOT EXISTS output_schema JSONB NOT NULL DEFAULT '{}'::jsonb`,
      `ALTER TABLE workflow_definitions
         ADD COLUMN IF NOT EXISTS output_schema JSONB NOT NULL DEFAULT '{}'::jsonb`,
      `ALTER TABLE workflow_runs
         ADD COLUMN IF NOT EXISTS output JSONB`
    ]
  },
  {
    id: '012_job_definition_runtime',
    statements: [
      `ALTER TABLE job_definitions
         ADD COLUMN IF NOT EXISTS runtime TEXT NOT NULL DEFAULT 'node'`
    ]
  },
  {
    id: '013_workflow_schedule_metadata',
    statements: [
      `ALTER TABLE workflow_definitions
         ADD COLUMN IF NOT EXISTS schedule_next_run_at TIMESTAMPTZ`,
      `ALTER TABLE workflow_definitions
         ADD COLUMN IF NOT EXISTS schedule_last_materialized_window JSONB`,
      `ALTER TABLE workflow_definitions
         ADD COLUMN IF NOT EXISTS schedule_catchup_cursor TIMESTAMPTZ`
    ]
  },
  {
    id: '014_job_bundle_artifact_data',
    statements: [
      `ALTER TABLE job_bundle_versions
         ADD COLUMN IF NOT EXISTS artifact_data BYTEA`
    ]
  },
  {
    id: '015_workflow_asset_catalog',
    statements: [
      `CREATE TABLE IF NOT EXISTS workflow_asset_declarations (
         id TEXT PRIMARY KEY,
         workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
         step_id TEXT NOT NULL,
         direction TEXT NOT NULL CHECK (direction IN ('produces', 'consumes')),
         asset_id TEXT NOT NULL,
         asset_schema JSONB,
         freshness JSONB,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         UNIQUE (workflow_definition_id, step_id, direction, asset_id)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_asset_declarations_asset
         ON workflow_asset_declarations(asset_id, direction);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_asset_declarations_step
         ON workflow_asset_declarations(workflow_definition_id, step_id);`,
      `CREATE TABLE IF NOT EXISTS workflow_run_step_assets (
         id TEXT PRIMARY KEY,
         workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
         workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
         workflow_run_step_id TEXT NOT NULL REFERENCES workflow_run_steps(id) ON DELETE CASCADE,
         step_id TEXT NOT NULL,
         asset_id TEXT NOT NULL,
         payload JSONB,
         asset_schema JSONB,
         freshness JSONB,
         produced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         UNIQUE (workflow_run_step_id, asset_id)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_run_step_assets_asset
         ON workflow_run_step_assets(asset_id, produced_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_run_step_assets_run
         ON workflow_run_step_assets(workflow_run_id, produced_at DESC);`
    ]
  },
  {
    id: '016_remove_filesystem_job_seeds',
    statements: [
      `DELETE FROM job_definitions WHERE id IN ('jobdef-fs-read-file', 'jobdef-fs-write-file');`
    ]
  },
  {
    id: '017_workflow_history_heartbeats',
    statements: [
      `ALTER TABLE job_runs
         ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
         ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
         ADD COLUMN IF NOT EXISTS failure_reason TEXT;`,
      `UPDATE job_runs
         SET retry_count = GREATEST(COALESCE(attempt, 1) - 1, 0)
         WHERE retry_count IS NULL OR (retry_count = 0 AND COALESCE(attempt, 1) > 1);`,
      `ALTER TABLE workflow_run_steps
         ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ,
         ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
         ADD COLUMN IF NOT EXISTS failure_reason TEXT;`,
      `UPDATE workflow_run_steps
         SET retry_count = GREATEST(COALESCE(attempt, 1) - 1, 0)
         WHERE retry_count IS NULL OR (retry_count = 0 AND COALESCE(attempt, 1) > 1);`,
      `CREATE TABLE IF NOT EXISTS workflow_execution_history (
         id BIGSERIAL PRIMARY KEY,
         workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
         workflow_run_step_id TEXT REFERENCES workflow_run_steps(id) ON DELETE CASCADE,
         step_id TEXT,
         event_type TEXT NOT NULL,
         event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_execution_history_run
         ON workflow_execution_history(workflow_run_id, id);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_execution_history_step
         ON workflow_execution_history(workflow_run_step_id, id);`
    ]
  },
  {
    id: '018_asset_auto_materialize',
    statements: [
      `ALTER TABLE workflow_asset_declarations
         ADD COLUMN IF NOT EXISTS auto_materialize JSONB;`
    ]
  },
  {
    id: '019_workflow_asset_partitions',
    statements: [
      `ALTER TABLE workflow_asset_declarations
         ADD COLUMN IF NOT EXISTS partitioning JSONB;`,
      `ALTER TABLE workflow_run_step_assets
         ADD COLUMN IF NOT EXISTS partition_key TEXT;`,
      `ALTER TABLE workflow_runs
         ADD COLUMN IF NOT EXISTS partition_key TEXT;`,
      `ALTER TABLE workflow_run_step_assets
         DROP CONSTRAINT IF EXISTS workflow_run_step_assets_workflow_run_step_id_asset_id_key;`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_run_step_assets_unique_partition
         ON workflow_run_step_assets (workflow_run_step_id, asset_id, COALESCE(partition_key, ''));`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_run_step_assets_asset_partition
         ON workflow_run_step_assets (asset_id, COALESCE(partition_key, ''), produced_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_run_step_assets_definition_partition
         ON workflow_run_step_assets (workflow_definition_id, asset_id, COALESCE(partition_key, ''), produced_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_runs_partition
         ON workflow_runs (workflow_definition_id, COALESCE(partition_key, ''));`
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
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT DO NOTHING', [migration.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
}
