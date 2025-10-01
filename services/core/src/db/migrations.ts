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
          'core.ingestion.processRepository',
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
          'core.build.run',
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
    id: '015_workflow_asset_core',
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
  },
  {
    id: '020_workflow_asset_manual_stale',
    statements: [
      `CREATE TABLE IF NOT EXISTS workflow_asset_stale_partitions (
         workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
         asset_id TEXT NOT NULL,
         partition_key TEXT,
         partition_key_normalized TEXT NOT NULL,
         requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         requested_by TEXT,
         note TEXT,
         PRIMARY KEY (workflow_definition_id, asset_id, partition_key_normalized)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_asset_stale_partitions_requested_at
         ON workflow_asset_stale_partitions (requested_at DESC);`
    ]
  },
  {
    id: '021_workflow_partition_parameters',
    statements: [
      `CREATE TABLE IF NOT EXISTS workflow_asset_partition_parameters (
         workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
         asset_id TEXT NOT NULL,
         partition_key TEXT,
         partition_key_normalized TEXT NOT NULL,
         parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
         source TEXT NOT NULL DEFAULT 'system',
         captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         PRIMARY KEY (workflow_definition_id, asset_id, partition_key_normalized)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_asset_partition_parameters_asset
         ON workflow_asset_partition_parameters (workflow_definition_id, asset_id, partition_key_normalized);`
    ]
  },
  {
    id: '022_auth_users_sessions',
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
         id TEXT PRIMARY KEY,
         primary_email TEXT NOT NULL,
         display_name TEXT,
         avatar_url TEXT,
         kind TEXT NOT NULL DEFAULT 'user',
         status TEXT NOT NULL DEFAULT 'active',
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         last_login_at TIMESTAMPTZ
       );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_primary_email
         ON users (LOWER(primary_email));`,
      `CREATE TABLE IF NOT EXISTS user_identities (
         id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         provider TEXT NOT NULL,
         provider_subject TEXT NOT NULL,
         email TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         last_seen_at TIMESTAMPTZ,
         UNIQUE (provider, provider_subject)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_user_identities_user
         ON user_identities(user_id);`,
      `CREATE TABLE IF NOT EXISTS roles (
         id TEXT PRIMARY KEY,
         slug TEXT NOT NULL UNIQUE,
         description TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE TABLE IF NOT EXISTS role_scopes (
         role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
         scope TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         PRIMARY KEY (role_id, scope)
       );`,
      `CREATE TABLE IF NOT EXISTS user_roles (
         user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         PRIMARY KEY (user_id, role_id)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_user_roles_user
         ON user_roles(user_id);`,
      `CREATE TABLE IF NOT EXISTS sessions (
         id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         session_token_hash TEXT NOT NULL,
         refresh_token_hash TEXT,
         ip TEXT,
         user_agent TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         expires_at TIMESTAMPTZ NOT NULL,
         last_seen_at TIMESTAMPTZ
       );`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_user
         ON sessions(user_id);`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
         ON sessions(expires_at);`,
      `CREATE TABLE IF NOT EXISTS api_keys (
         id TEXT PRIMARY KEY,
         user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         name TEXT,
         prefix TEXT NOT NULL UNIQUE,
         token_hash TEXT NOT NULL UNIQUE,
         scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
         metadata JSONB,
         created_by_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
         last_used_at TIMESTAMPTZ,
         expires_at TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         revoked_at TIMESTAMPTZ
       );`,
      `CREATE INDEX IF NOT EXISTS idx_api_keys_user
         ON api_keys(user_id);`,
      `CREATE INDEX IF NOT EXISTS idx_api_keys_prefix
         ON api_keys(prefix);`,
      `CREATE TABLE IF NOT EXISTS api_key_events (
         id BIGSERIAL PRIMARY KEY,
         api_key_id TEXT REFERENCES api_keys(id) ON DELETE SET NULL,
         user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
         event TEXT NOT NULL,
         metadata JSONB,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_api_key_events_key_created
         ON api_key_events(api_key_id, created_at DESC);`,
      `INSERT INTO roles (id, slug, description)
         VALUES
           ('role-viewer', 'viewer', 'Default read-only operator role'),
           ('role-editor', 'editor', 'Can modify workflows and jobs'),
           ('role-admin', 'admin', 'Full administrative access')
       ON CONFLICT (slug) DO UPDATE
         SET description = EXCLUDED.description;`,
      `INSERT INTO role_scopes (role_id, scope)
         VALUES
           ('role-viewer', 'jobs:run'),
           ('role-viewer', 'workflows:run'),
           ('role-viewer', 'job-bundles:read'),
           ('role-viewer', 'auth:manage-api-keys'),
           ('role-editor', 'jobs:run'),
           ('role-editor', 'workflows:run'),
           ('role-editor', 'job-bundles:read'),
           ('role-editor', 'jobs:write'),
           ('role-editor', 'workflows:write'),
           ('role-editor', 'auth:manage-api-keys'),
           ('role-admin', 'jobs:run'),
           ('role-admin', 'workflows:run'),
           ('role-admin', 'job-bundles:read'),
           ('role-admin', 'jobs:write'),
           ('role-admin', 'workflows:write'),
           ('role-admin', 'job-bundles:write'),
           ('role-admin', 'auth:manage-api-keys')
      ON CONFLICT DO NOTHING;`
    ]
  },
  {
    id: '023_repository_metadata_strategy',
    statements: [
      `ALTER TABLE repositories
         ADD COLUMN IF NOT EXISTS metadata_strategy TEXT NOT NULL DEFAULT 'auto';`
    ]
  },
  {
    id: '024_workflow_schedules',
    statements: [
      `CREATE TABLE IF NOT EXISTS workflow_schedules (
         id TEXT PRIMARY KEY,
         workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
         name TEXT,
         description TEXT,
         cron TEXT NOT NULL,
         timezone TEXT,
         parameters JSONB,
         start_window TIMESTAMPTZ,
         end_window TIMESTAMPTZ,
         catch_up BOOLEAN NOT NULL DEFAULT TRUE,
         next_run_at TIMESTAMPTZ,
         last_materialized_window JSONB,
         catchup_cursor TIMESTAMPTZ,
         is_active BOOLEAN NOT NULL DEFAULT TRUE,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_schedules_definition
         ON workflow_schedules(workflow_definition_id);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_schedules_next_run
         ON workflow_schedules(next_run_at)
         WHERE is_active = TRUE AND next_run_at IS NOT NULL;`,
      `ALTER TABLE workflow_definitions
         DROP COLUMN IF EXISTS schedule_next_run_at;`,
      `ALTER TABLE workflow_definitions
         DROP COLUMN IF EXISTS schedule_last_materialized_window;`,
      `ALTER TABLE workflow_definitions
         DROP COLUMN IF EXISTS schedule_catchup_cursor;`
    ]
  },
  {
    id: '025_job_bundle_replacements',
    statements: [
      `ALTER TABLE job_bundle_versions
         ADD COLUMN IF NOT EXISTS replaced_at TIMESTAMPTZ`,
      `ALTER TABLE job_bundle_versions
         ADD COLUMN IF NOT EXISTS replaced_by TEXT`
    ]
  },
  {
    id: '026_workflow_events',
    statements: [
      `CREATE TABLE IF NOT EXISTS workflow_events (
         id TEXT PRIMARY KEY,
         type TEXT NOT NULL,
         source TEXT NOT NULL,
         occurred_at TIMESTAMPTZ NOT NULL,
         received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         payload JSONB NOT NULL DEFAULT '{}'::jsonb,
         correlation_id TEXT,
         ttl_ms INTEGER,
         metadata JSONB
       );`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_events_type ON workflow_events(type);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_events_source ON workflow_events(source);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_events_occurred_at ON workflow_events(occurred_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_events_received_at ON workflow_events(received_at DESC);`
    ]
  },
  {
    id: '027_workflow_event_triggers',
    statements: [
      `CREATE TABLE IF NOT EXISTS workflow_event_triggers (
         id TEXT PRIMARY KEY,
         workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
         version INTEGER NOT NULL DEFAULT 1,
         status TEXT NOT NULL DEFAULT 'active',
         name TEXT,
         description TEXT,
         event_type TEXT NOT NULL,
         event_source TEXT,
         predicates JSONB NOT NULL DEFAULT '[]'::jsonb,
         parameter_template JSONB,
         throttle_window_ms INTEGER,
         throttle_count INTEGER,
         max_concurrency INTEGER,
         idempotency_key_expression TEXT,
         metadata JSONB,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         created_by TEXT,
         updated_by TEXT
       );`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_event_triggers_workflow
         ON workflow_event_triggers(workflow_definition_id);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_event_triggers_type_source
         ON workflow_event_triggers(event_type, COALESCE(event_source, ''));`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_event_triggers_status
         ON workflow_event_triggers(status);`,
      `CREATE TABLE IF NOT EXISTS workflow_trigger_deliveries (
         id TEXT PRIMARY KEY,
         trigger_id TEXT NOT NULL REFERENCES workflow_event_triggers(id) ON DELETE CASCADE,
         workflow_definition_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
         event_id TEXT NOT NULL,
         status TEXT NOT NULL,
         attempts INTEGER NOT NULL DEFAULT 0,
         last_error TEXT,
         workflow_run_id TEXT,
         dedupe_key TEXT,
         next_attempt_at TIMESTAMPTZ,
         throttled_until TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_trigger_deliveries_trigger
         ON workflow_trigger_deliveries(trigger_id);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_trigger_deliveries_event
         ON workflow_trigger_deliveries(event_id);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_trigger_deliveries_status
         ON workflow_trigger_deliveries(status);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_trigger_deliveries_dedupe
         ON workflow_trigger_deliveries(trigger_id, dedupe_key)`
    ]
  },
  {
    id: '028_filestore_scopes',
    statements: [
      `INSERT INTO role_scopes (role_id, scope)
         VALUES
           ('role-viewer', 'filestore:read'),
           ('role-editor', 'filestore:read'),
           ('role-editor', 'filestore:write'),
           ('role-admin', 'filestore:read'),
           ('role-admin', 'filestore:write'),
           ('role-admin', 'filestore:admin')
       ON CONFLICT DO NOTHING;`
    ]
  },
  {
    id: '029_event_scheduler_state',
    statements: [
      `CREATE TABLE IF NOT EXISTS event_scheduler_source_events (
         id BIGSERIAL PRIMARY KEY,
         source TEXT NOT NULL,
         event_time TIMESTAMPTZ NOT NULL
       );`,
      `CREATE INDEX IF NOT EXISTS idx_event_scheduler_source_events_source_time
         ON event_scheduler_source_events (source, event_time);`,
      `CREATE TABLE IF NOT EXISTS event_scheduler_source_pauses (
         source TEXT PRIMARY KEY,
         paused_until TIMESTAMPTZ NOT NULL,
         reason TEXT NOT NULL,
         details JSONB,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE TABLE IF NOT EXISTS event_scheduler_trigger_failures (
         id BIGSERIAL PRIMARY KEY,
         trigger_id TEXT NOT NULL,
         failure_time TIMESTAMPTZ NOT NULL,
         reason TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_event_scheduler_trigger_failures_trigger_time
         ON event_scheduler_trigger_failures (trigger_id, failure_time);`,
      `CREATE TABLE IF NOT EXISTS event_scheduler_trigger_pauses (
         trigger_id TEXT PRIMARY KEY,
         paused_until TIMESTAMPTZ NOT NULL,
         reason TEXT NOT NULL,
         failures INTEGER NOT NULL DEFAULT 0,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE TABLE IF NOT EXISTS event_scheduler_source_metrics (
         source TEXT PRIMARY KEY,
         total BIGINT NOT NULL DEFAULT 0,
         throttled BIGINT NOT NULL DEFAULT 0,
         dropped BIGINT NOT NULL DEFAULT 0,
         failures BIGINT NOT NULL DEFAULT 0,
         total_lag_ms BIGINT NOT NULL DEFAULT 0,
         last_lag_ms BIGINT NOT NULL DEFAULT 0,
         max_lag_ms BIGINT NOT NULL DEFAULT 0,
         last_event_at TIMESTAMPTZ
       );`,
      `CREATE TABLE IF NOT EXISTS event_scheduler_trigger_metrics (
         trigger_id TEXT PRIMARY KEY,
         workflow_definition_id TEXT NOT NULL,
         count_filtered BIGINT NOT NULL DEFAULT 0,
         count_matched BIGINT NOT NULL DEFAULT 0,
         count_launched BIGINT NOT NULL DEFAULT 0,
         count_throttled BIGINT NOT NULL DEFAULT 0,
         count_skipped BIGINT NOT NULL DEFAULT 0,
         count_failed BIGINT NOT NULL DEFAULT 0,
         count_paused BIGINT NOT NULL DEFAULT 0,
         last_status TEXT,
         last_updated_at TIMESTAMPTZ,
         last_error TEXT
       );`
    ]
  },
  {
    id: '030_asset_materializer_distributed_state',
    statements: [
      `CREATE TABLE IF NOT EXISTS asset_materializer_inflight_runs (
         workflow_definition_id TEXT PRIMARY KEY REFERENCES workflow_definitions(id) ON DELETE CASCADE,
         workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE CASCADE,
         reason TEXT NOT NULL,
         asset_id TEXT,
         partition_key TEXT,
         requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         context JSONB,
         claim_owner TEXT NOT NULL,
         claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE TABLE IF NOT EXISTS asset_materializer_failure_state (
         workflow_definition_id TEXT PRIMARY KEY REFERENCES workflow_definitions(id) ON DELETE CASCADE,
         failures INTEGER NOT NULL DEFAULT 0,
         next_eligible_at TIMESTAMPTZ,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`
    ]
  },
  {
    id: '031_saved_core_searches',
    statements: [
      `CREATE TABLE IF NOT EXISTS saved_core_searches (
         id TEXT PRIMARY KEY,
         slug TEXT NOT NULL UNIQUE,
         owner_key TEXT NOT NULL,
         owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
         owner_subject TEXT NOT NULL,
         owner_kind TEXT NOT NULL,
         owner_token_hash TEXT,
         name TEXT NOT NULL,
         description TEXT,
         search_input TEXT NOT NULL,
         status_filters TEXT[] NOT NULL DEFAULT '{}',
         sort TEXT NOT NULL DEFAULT 'relevance',
         visibility TEXT NOT NULL DEFAULT 'private',
         applied_count BIGINT NOT NULL DEFAULT 0,
         shared_count BIGINT NOT NULL DEFAULT 0,
         last_applied_at TIMESTAMPTZ,
         last_shared_at TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_saved_core_searches_owner_key
         ON saved_core_searches(owner_key);`,
      `CREATE INDEX IF NOT EXISTS idx_saved_core_searches_owner_user
         ON saved_core_searches(owner_user_id)
         WHERE owner_user_id IS NOT NULL;`
    ]
  },
  {
    id: '032_durable_retry_foundations',
    statements: [
      `ALTER TABLE workflow_trigger_deliveries
         ADD COLUMN IF NOT EXISTS retry_state TEXT NOT NULL DEFAULT 'pending';`,
      `ALTER TABLE workflow_trigger_deliveries
         ADD COLUMN IF NOT EXISTS retry_attempts INTEGER NOT NULL DEFAULT 0;`,
      `ALTER TABLE workflow_trigger_deliveries
         ADD COLUMN IF NOT EXISTS retry_metadata JSONB;`,
      `ALTER TABLE workflow_run_steps
         ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;`,
      `ALTER TABLE workflow_run_steps
         ADD COLUMN IF NOT EXISTS retry_state TEXT NOT NULL DEFAULT 'pending';`,
      `ALTER TABLE workflow_run_steps
         ADD COLUMN IF NOT EXISTS retry_attempts INTEGER NOT NULL DEFAULT 0;`,
      `ALTER TABLE workflow_run_steps
         ADD COLUMN IF NOT EXISTS retry_metadata JSONB;`,
      `CREATE TABLE IF NOT EXISTS event_ingress_retries (
         event_id TEXT PRIMARY KEY REFERENCES workflow_events(id) ON DELETE CASCADE,
         source TEXT NOT NULL,
         retry_state TEXT NOT NULL DEFAULT 'pending',
         attempts INTEGER NOT NULL DEFAULT 0,
         next_attempt_at TIMESTAMPTZ NOT NULL,
         last_error TEXT,
         metadata JSONB,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_event_ingress_retries_state_next_attempt
         ON event_ingress_retries (retry_state, next_attempt_at);`
    ]
  },
  {
    id: '033_unified_event_api',
    statements: [
      `CREATE INDEX IF NOT EXISTS idx_workflow_events_correlation_id
         ON workflow_events (correlation_id)
         WHERE correlation_id IS NOT NULL;`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_events_payload_jsonpath
         ON workflow_events USING gin (payload jsonb_path_ops);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_events_occurred_id
         ON workflow_events (occurred_at DESC, id DESC);`
    ]
  },
  {
    id: '034_event_saved_views',
    statements: [
      `CREATE TABLE IF NOT EXISTS event_saved_views (
         id TEXT PRIMARY KEY,
         slug TEXT NOT NULL UNIQUE,
         owner_key TEXT NOT NULL,
         owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
         owner_subject TEXT NOT NULL,
         owner_kind TEXT NOT NULL,
         owner_token_hash TEXT,
         name TEXT NOT NULL,
         description TEXT,
         filters JSONB NOT NULL DEFAULT '{}'::jsonb,
         visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'shared')),
         applied_count BIGINT NOT NULL DEFAULT 0,
         shared_count BIGINT NOT NULL DEFAULT 0,
         last_applied_at TIMESTAMPTZ,
         last_shared_at TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         CHECK (owner_kind IN ('user', 'service'))
       );`,
      `CREATE INDEX IF NOT EXISTS idx_event_saved_views_owner_key
         ON event_saved_views(owner_key);`,
      `CREATE INDEX IF NOT EXISTS idx_event_saved_views_owner_user
         ON event_saved_views(owner_user_id)
         WHERE owner_user_id IS NOT NULL;`,
      `CREATE INDEX IF NOT EXISTS idx_event_saved_views_visibility_shared
         ON event_saved_views(visibility)
         WHERE visibility = 'shared';`
    ]
  },
  {
    id: '035_service_registry_shared_state',
    statements: [
      `CREATE TABLE IF NOT EXISTS service_manifests (
         id BIGSERIAL PRIMARY KEY,
         module_id TEXT NOT NULL,
         module_version INTEGER NOT NULL,
         service_slug TEXT NOT NULL,
         definition JSONB NOT NULL,
         checksum TEXT NOT NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         superseded_at TIMESTAMPTZ,
         UNIQUE (module_id, module_version, service_slug)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_service_manifests_active_slug
         ON service_manifests(service_slug)
         WHERE superseded_at IS NULL;`,
      `CREATE INDEX IF NOT EXISTS idx_service_manifests_active_module
         ON service_manifests(module_id, module_version)
         WHERE superseded_at IS NULL;`,
      `ALTER TABLE service_networks
         ADD COLUMN IF NOT EXISTS module_id TEXT;`,
      `ALTER TABLE service_networks
         ADD COLUMN IF NOT EXISTS module_version INTEGER;`,
      `ALTER TABLE service_networks
         ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;`,
      `ALTER TABLE service_networks
         ADD COLUMN IF NOT EXISTS definition JSONB;`,
      `ALTER TABLE service_networks
         ADD COLUMN IF NOT EXISTS checksum TEXT;`,
      `CREATE INDEX IF NOT EXISTS idx_service_networks_module
         ON service_networks(module_id);`,
      `CREATE TABLE IF NOT EXISTS service_health_snapshots (
         id BIGSERIAL PRIMARY KEY,
         service_slug TEXT NOT NULL REFERENCES services(slug) ON DELETE CASCADE,
         version INTEGER NOT NULL,
         status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'unreachable')),
         status_message TEXT,
         latency_ms INTEGER,
         status_code INTEGER,
         checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         base_url TEXT,
         health_endpoint TEXT,
         metadata JSONB,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         UNIQUE (service_slug, version)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_service_health_snapshots_checked
         ON service_health_snapshots(service_slug, checked_at DESC);`
    ]
  },
  {
    id: '036_example_bundle_durable_storage',
    statements: [
      `CREATE TABLE IF NOT EXISTS example_bundle_artifacts (
         id TEXT PRIMARY KEY,
         slug TEXT NOT NULL,
         fingerprint TEXT NOT NULL,
         version TEXT,
         checksum TEXT NOT NULL,
         filename TEXT,
         storage_kind TEXT NOT NULL CHECK (storage_kind IN ('local', 's3')),
         storage_key TEXT NOT NULL,
         storage_url TEXT,
         content_type TEXT,
         size BIGINT,
         job_id TEXT,
         uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         UNIQUE (slug, fingerprint)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_example_bundle_artifacts_slug_uploaded
         ON example_bundle_artifacts(slug, uploaded_at DESC);`,
      `CREATE TABLE IF NOT EXISTS example_bundle_status (
         slug TEXT PRIMARY KEY,
         fingerprint TEXT NOT NULL,
         stage TEXT NOT NULL,
         state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed')),
         job_id TEXT,
         version TEXT,
         checksum TEXT,
         filename TEXT,
         cached BOOLEAN,
         error TEXT,
         message TEXT,
         artifact_id TEXT REFERENCES example_bundle_artifacts(id) ON DELETE SET NULL,
         completed_at TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE INDEX IF NOT EXISTS idx_example_bundle_status_updated
         ON example_bundle_status(updated_at DESC);`
    ]
  },
  {
    id: '037_core_event_sampling_store',
    statements: [
      `CREATE TABLE IF NOT EXISTS workflow_event_producer_samples (
         workflow_definition_id TEXT NOT NULL,
         workflow_run_step_id TEXT NOT NULL,
         job_slug TEXT NOT NULL,
         event_type TEXT NOT NULL,
         event_source TEXT NOT NULL,
         sample_count BIGINT NOT NULL DEFAULT 0,
         first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         expires_at TIMESTAMPTZ,
         cleanup_attempted_at TIMESTAMPTZ,
         PRIMARY KEY (
           workflow_definition_id,
           workflow_run_step_id,
           job_slug,
           event_type,
           event_source
         ),
         CHECK (sample_count >= 0)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_event_samples_job_slug
         ON workflow_event_producer_samples(job_slug);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_event_samples_last_seen
         ON workflow_event_producer_samples(last_seen_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_workflow_event_samples_expires_at
         ON workflow_event_producer_samples(expires_at)
         WHERE expires_at IS NOT NULL;`
    ]
  },
  {
    id: '038_event_sampling_replay_state',
    statements: [
      `CREATE TABLE IF NOT EXISTS workflow_event_sampling_replay_state (
         event_id TEXT PRIMARY KEY REFERENCES workflow_events(id) ON DELETE CASCADE,
         status TEXT NOT NULL,
         attempts INTEGER NOT NULL DEFAULT 1,
         workflow_definition_id TEXT,
         workflow_run_id TEXT,
         workflow_run_step_id TEXT,
         job_run_id TEXT,
         job_slug TEXT,
         last_error TEXT,
         processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         CHECK (status IN ('succeeded', 'failed', 'skipped')),
         CHECK (attempts >= 1)
       );`,
      `CREATE INDEX IF NOT EXISTS idx_event_sampling_replay_status
         ON workflow_event_sampling_replay_state(status, updated_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_event_sampling_replay_processed_at
         ON workflow_event_sampling_replay_state(processed_at DESC);`
    ]
  },
  {
    id: '039_runtime_scaling_policies',
    statements: [
      `CREATE TABLE IF NOT EXISTS runtime_scaling_policies (
         target TEXT PRIMARY KEY,
         desired_concurrency INTEGER NOT NULL,
         reason TEXT,
         updated_by TEXT,
         updated_by_kind TEXT,
         updated_by_token_hash TEXT,
         metadata JSONB,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         CONSTRAINT runtime_scaling_policies_concurrency_check CHECK (desired_concurrency >= 0)
       );`,
      `CREATE TABLE IF NOT EXISTS runtime_scaling_acknowledgements (
         target TEXT NOT NULL,
         instance_id TEXT NOT NULL,
         applied_concurrency INTEGER NOT NULL,
         status TEXT NOT NULL DEFAULT 'ok',
         error TEXT,
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         PRIMARY KEY (target, instance_id),
         CONSTRAINT runtime_scaling_acknowledgements_concurrency_check CHECK (applied_concurrency >= 0),
         CONSTRAINT runtime_scaling_acknowledgements_status_check CHECK (status IN ('ok', 'pending', 'error'))
       );`,
      `CREATE INDEX IF NOT EXISTS idx_runtime_scaling_ack_target_updated
         ON runtime_scaling_acknowledgements(target, updated_at DESC);`
    ]
  },
  {
    id: '040_saved_searches_generalization',
    statements: [
      `ALTER TABLE saved_core_searches
         ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'core';`,
      `ALTER TABLE saved_core_searches
         ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;`,
      `CREATE INDEX IF NOT EXISTS idx_saved_core_searches_category
         ON saved_core_searches(category);`
    ]
  },
  {
    id: '041_workflow_run_keys',
    statements: [
      `ALTER TABLE workflow_runs
         ADD COLUMN IF NOT EXISTS run_key TEXT;`,
      `ALTER TABLE workflow_runs
         ADD COLUMN IF NOT EXISTS run_key_normalized TEXT;`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_runs_active_run_key
         ON workflow_runs (workflow_definition_id, run_key_normalized)
         WHERE run_key_normalized IS NOT NULL
           AND status IN ('pending', 'running');`
    ]
  },
  {
    id: '042_trigger_run_key_template',
    statements: [
      `ALTER TABLE workflow_event_triggers
         ADD COLUMN IF NOT EXISTS run_key_template TEXT;`
    ]
  },
  {
    id: '043_module_registry',
    statements: [
      `CREATE TABLE IF NOT EXISTS modules (
         id TEXT PRIMARY KEY,
         display_name TEXT,
         description TEXT,
         keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
         latest_version TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       );`,
      `CREATE TABLE IF NOT EXISTS module_artifacts (
         id TEXT PRIMARY KEY,
         module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
         version TEXT NOT NULL,
         manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
         artifact_checksum TEXT NOT NULL,
         artifact_path TEXT NOT NULL,
         artifact_storage TEXT NOT NULL DEFAULT 'filesystem',
         artifact_content_type TEXT,
         artifact_size BIGINT,
         published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         UNIQUE (module_id, version)
       );`,
      `CREATE TABLE IF NOT EXISTS module_targets (
         id TEXT PRIMARY KEY,
         module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
         module_version TEXT NOT NULL,
         artifact_id TEXT NOT NULL REFERENCES module_artifacts(id) ON DELETE CASCADE,
         target_name TEXT NOT NULL,
         target_kind TEXT NOT NULL,
         target_version TEXT NOT NULL,
         fingerprint TEXT NOT NULL,
         display_name TEXT,
         description TEXT,
         capability_overrides TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
         metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         UNIQUE (artifact_id, target_name),
         UNIQUE (module_id, target_name, target_version),
         CONSTRAINT module_targets_kind_check CHECK (target_kind IN ('job', 'service', 'workflow'))
       );`,
      `CREATE INDEX IF NOT EXISTS idx_module_artifacts_module
         ON module_artifacts(module_id, published_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_module_targets_module
         ON module_targets(module_id, target_name);`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_module_targets_fingerprint
         ON module_targets(fingerprint);`
    ]
  },
  {
    id: '044_job_module_bindings',
    statements: [
      `ALTER TABLE job_definitions
         ADD COLUMN IF NOT EXISTS module_id TEXT,
         ADD COLUMN IF NOT EXISTS module_version TEXT,
         ADD COLUMN IF NOT EXISTS module_artifact_id TEXT,
         ADD COLUMN IF NOT EXISTS module_target_name TEXT,
         ADD COLUMN IF NOT EXISTS module_target_version TEXT,
         ADD COLUMN IF NOT EXISTS module_target_fingerprint TEXT;`,
      `CREATE INDEX IF NOT EXISTS idx_job_definitions_module_target
         ON job_definitions(module_id, module_target_name);`,
      `ALTER TABLE job_runs
         ADD COLUMN IF NOT EXISTS module_id TEXT,
         ADD COLUMN IF NOT EXISTS module_version TEXT,
         ADD COLUMN IF NOT EXISTS module_artifact_id TEXT,
         ADD COLUMN IF NOT EXISTS module_target_name TEXT,
         ADD COLUMN IF NOT EXISTS module_target_version TEXT,
         ADD COLUMN IF NOT EXISTS module_target_fingerprint TEXT;`,
      `CREATE INDEX IF NOT EXISTS idx_job_runs_module_target
         ON job_runs(module_id, module_target_name);`
    ]
  },
  {
    id: '045_module_enablement',
    statements: [
      `ALTER TABLE modules
         ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT TRUE;`
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
