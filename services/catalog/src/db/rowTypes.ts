export type RepositoryRow = {
  id: string;
  name: string;
  description: string;
  repo_url: string;
  dockerfile_path: string;
  ingest_status: string;
  updated_at: string;
  last_ingested_at: string | null;
  ingest_error: string | null;
  ingest_attempts: number;
  metadata_strategy: string | null;
  launch_env_templates: unknown;
  created_at: string;
};

export type TagRow = {
  repository_id: string;
  key: string;
  value: string;
  source: string;
};

export type BuildRow = {
  id: string;
  repository_id: string;
  status: string;
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

export type LaunchRow = {
  id: string;
  repository_id: string;
  build_id: string;
  status: string;
  instance_url: string | null;
  container_id: string | null;
  port: number | null;
  internal_port: number | null;
  container_ip: string | null;
  resource_profile: string | null;
  command: string | null;
  env_vars: unknown;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  stopped_at: string | null;
  expires_at: string | null;
};

export type RepositoryPreviewRow = {
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
  created_at: string;
};

export type IngestionEventRow = {
  id: number;
  repository_id: string;
  status: string;
  message: string | null;
  attempt: number | null;
  commit_sha: string | null;
  duration_ms: number | null;
  created_at: string;
};

export type ServiceNetworkRow = {
  repository_id: string;
  manifest_source: string | null;
  module_id: string | null;
  module_version: number | null;
  version: number;
  definition: unknown;
  checksum: string | null;
  created_at: string;
  updated_at: string;
};

export type ServiceNetworkMemberRow = {
  network_repository_id: string;
  member_repository_id: string;
  launch_order: number;
  wait_for_build: boolean;
  env_vars: unknown;
  depends_on: unknown;
  created_at: string;
  updated_at: string;
};

export type ServiceNetworkLaunchMemberRow = {
  network_launch_id: string;
  member_launch_id: string;
  member_repository_id: string;
  launch_order: number;
  created_at: string;
  updated_at: string;
};

export type ServiceManifestRow = {
  id: number;
  module_id: string;
  module_version: number;
  service_slug: string;
  definition: unknown;
  checksum: string;
  created_at: string;
  updated_at: string;
  superseded_at: string | null;
};

export type ServiceHealthSnapshotRow = {
  id: number;
  service_slug: string;
  version: number;
  status: string;
  status_message: string | null;
  latency_ms: number | null;
  status_code: number | null;
  checked_at: string;
  base_url: string | null;
  health_endpoint: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type ExampleBundleArtifactRow = {
  id: string;
  slug: string;
  fingerprint: string;
  version: string | null;
  checksum: string;
  filename: string | null;
  storage_kind: string;
  storage_key: string;
  storage_url: string | null;
  content_type: string | null;
  size: number | null;
  job_id: string | null;
  uploaded_at: string;
  created_at: string;
};

export type ExampleBundleStatusRow = {
  slug: string;
  fingerprint: string;
  stage: string;
  state: string;
  job_id: string | null;
  version: string | null;
  checksum: string | null;
  filename: string | null;
  cached: boolean | null;
  error: string | null;
  message: string | null;
  artifact_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ServiceRow = {
  id: string;
  slug: string;
  display_name: string;
  kind: string;
  base_url: string;
  status: string;
  status_message: string | null;
  capabilities: unknown;
  metadata: unknown;
  last_healthy_at: string | null;
  created_at: string;
  updated_at: string;
};

export type JobDefinitionRow = {
  id: string;
  slug: string;
  name: string;
  version: number;
  type: string;
  runtime: string;
  entry_point: string;
  parameters_schema: unknown;
  default_parameters: unknown;
  output_schema: unknown;
  timeout_ms: number | null;
  retry_policy: unknown;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type JobRunRow = {
  id: string;
  job_definition_id: string;
  status: string;
  parameters: unknown;
  result: unknown;
  error_message: string | null;
  logs_url: string | null;
  metrics: unknown;
  context: unknown;
  timeout_ms: number | null;
  attempt: number;
  max_attempts: number | null;
  duration_ms: number | null;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  last_heartbeat_at: string | null;
  retry_count: number;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type JobBundleRow = {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
  latest_version: string | null;
  created_at: string;
  updated_at: string;
};

export type JobBundleVersionRow = {
  id: string;
  bundle_id: string;
  slug: string;
  version: string;
  manifest: unknown;
  checksum: string;
  capability_flags: unknown;
  artifact_storage: string;
  artifact_path: string;
  artifact_content_type: string | null;
  artifact_size: string | number | null;
  artifact_data: Buffer | null;
  immutable: boolean;
  status: string;
  published_by: string | null;
  published_by_kind: string | null;
  published_by_token_hash: string | null;
  published_at: string;
  deprecated_at: string | null;
  replaced_at: string | null;
  replaced_by: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type WorkflowDefinitionRow = {
  id: string;
  slug: string;
  name: string;
  version: number;
  description: string | null;
  steps: unknown;
  triggers: unknown;
  parameters_schema: unknown;
  default_parameters: unknown;
  output_schema: unknown;
  metadata: unknown;
  dag: unknown;
  created_at: string;
  updated_at: string;
};

export type WorkflowScheduleRow = {
  id: string;
  workflow_definition_id: string;
  name: string | null;
  description: string | null;
  cron: string;
  timezone: string | null;
  parameters: unknown;
  start_window: string | null;
  end_window: string | null;
  catch_up: boolean;
  next_run_at: string | null;
  last_materialized_window: unknown;
  catchup_cursor: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type WorkflowAssetDeclarationRow = {
  id: string;
  workflow_definition_id: string;
  step_id: string;
  direction: string;
  asset_id: string;
  asset_schema: unknown;
  freshness: unknown;
  auto_materialize: unknown;
  partitioning: unknown;
  created_at: string;
  updated_at: string;
};

export type WorkflowRunRow = {
  id: string;
  workflow_definition_id: string;
  status: string;
  run_key: string | null;
  run_key_normalized: string | null;
  parameters: unknown;
  context: unknown;
  output: unknown;
  error_message: string | null;
  current_step_id: string | null;
  current_step_index: number | null;
  metrics: unknown;
  triggered_by: string | null;
  trigger: unknown;
  partition_key: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
  retry_pending_steps?: number | null;
  retry_next_attempt_at?: string | null;
  retry_overdue_steps?: number | null;
};

export type WorkflowRunStepAssetRow = {
  id: string;
  workflow_definition_id: string;
  workflow_run_id: string;
  workflow_run_step_id: string;
  step_id: string;
  asset_id: string;
  payload: unknown;
  asset_schema: unknown;
  freshness: unknown;
  partition_key: string | null;
  produced_at: string;
  created_at: string;
  updated_at: string;
};

export type WorkflowAssetSnapshotRow = {
  id: string;
  workflow_definition_id: string;
  workflow_run_id: string;
  workflow_run_step_id: string;
  step_id: string;
  asset_id: string;
  payload: unknown;
  asset_schema: unknown;
  freshness: unknown;
  partition_key: string | null;
  produced_at: string;
  created_at: string;
  updated_at: string;
  step_status: string;
  run_status: string;
  run_started_at: string | null;
  run_completed_at: string | null;
};

export type WorkflowAssetStalePartitionRow = {
  workflow_definition_id: string;
  asset_id: string;
  partition_key: string | null;
  partition_key_normalized: string;
  requested_at: string;
  requested_by: string | null;
  note: string | null;
};

export type WorkflowAssetPartitionParametersRow = {
  workflow_definition_id: string;
  asset_id: string;
  partition_key: string | null;
  partition_key_normalized: string;
  parameters: unknown;
  source: string;
  captured_at: string;
  updated_at: string;
};

export type WorkflowRunStepRow = {
  id: string;
  workflow_run_id: string;
  step_id: string;
  status: string;
  attempt: number;
  job_run_id: string | null;
  input: unknown;
  output: unknown;
  error_message: string | null;
  logs_url: string | null;
  metrics: unknown;
  context: unknown;
  started_at: string | null;
  completed_at: string | null;
  parent_step_id: string | null;
  fanout_index: number | null;
  template_step_id: string | null;
  last_heartbeat_at: string | null;
  retry_count: number;
  failure_reason: string | null;
  next_attempt_at: string | null;
  retry_state: string;
  retry_attempts: number;
  retry_metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type WorkflowExecutionHistoryRow = {
  id: string;
  workflow_run_id: string;
  workflow_run_step_id: string | null;
  step_id: string | null;
  event_type: string;
  event_payload: unknown;
  created_at: string;
};

export type UserRow = {
  id: string;
  primary_email: string;
  display_name: string | null;
  avatar_url: string | null;
  kind: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

export type UserIdentityRow = {
  id: string;
  user_id: string;
  provider: string;
  provider_subject: string;
  email: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
};

export type SessionRow = {
  id: string;
  user_id: string;
  session_token_hash: string;
  refresh_token_hash: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  last_seen_at: string | null;
};

export type ApiKeyRow = {
  id: string;
  user_id: string;
  name: string | null;
  prefix: string;
  token_hash: string;
  scopes: unknown;
  metadata: unknown;
  created_by_session_id: string | null;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

export type RoleRow = {
  id: string;
  slug: string;
  description: string | null;
  created_at: string;
};

export type RoleScopeRow = {
  role_id: string;
  scope: string;
  created_at: string;
};

export type WorkflowEventTriggerRow = {
  id: string;
  workflow_definition_id: string;
  version: number;
  status: string;
  name: string | null;
  description: string | null;
  event_type: string;
  event_source: string | null;
  predicates: unknown;
  parameter_template: unknown;
  run_key_template: string | null;
  throttle_window_ms: number | null;
  throttle_count: number | null;
  max_concurrency: number | null;
  idempotency_key_expression: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type SavedCatalogSearchRow = {
  id: string;
  slug: string;
  owner_key: string;
  owner_user_id: string | null;
  owner_subject: string;
  owner_kind: string;
  owner_token_hash: string | null;
  name: string;
  description: string | null;
  search_input: string;
  status_filters: string[];
  sort: string;
  category: string | null;
  config: unknown;
  visibility: string;
  applied_count: string | number;
  shared_count: string | number;
  last_applied_at: string | null;
  last_shared_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkflowTriggerDeliveryRow = {
  id: string;
  trigger_id: string;
  workflow_definition_id: string;
  event_id: string;
  status: string;
  attempts: number;
  last_error: string | null;
  workflow_run_id: string | null;
  dedupe_key: string | null;
  next_attempt_at: string | null;
  throttled_until: string | null;
  retry_state: string;
  retry_attempts: number;
  retry_metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type WorkflowActivityRow = {
  kind: 'run' | 'delivery';
  entry_id: string;
  workflow_definition_id: string;
  workflow_slug: string;
  workflow_name: string;
  workflow_version: number;
  status: string;
  occurred_at: string;
  trigger_id: string | null;
  run_data: WorkflowRunRow | null;
  linked_run_data: WorkflowRunRow | null;
  delivery_data: WorkflowTriggerDeliveryRow | null;
  trigger_data:
    | {
        id: string | null;
        name: string | null;
        eventType: string | null;
        eventSource: string | null;
        status: string | null;
      }
    | null;
};

export type WorkflowEventRow = {
  id: string;
  type: string;
  source: string;
  occurred_at: string;
  received_at: string;
  payload: unknown;
  correlation_id: string | null;
  ttl_ms: number | null;
  metadata: unknown;
};

export type WorkflowEventProducerSampleRow = {
  workflow_definition_id: string;
  workflow_run_step_id: string;
  job_slug: string;
  event_type: string;
  event_source: string;
  sample_count: string | number;
  first_seen_at: string;
  last_seen_at: string;
  expires_at: string | null;
  cleanup_attempted_at: string | null;
};

export type EventIngressRetryRow = {
  event_id: string;
  source: string;
  retry_state: string;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

export type EventSavedViewRow = {
  id: string;
  slug: string;
  owner_key: string;
  owner_user_id: string | null;
  owner_subject: string;
  owner_kind: string;
  owner_token_hash: string | null;
  name: string;
  description: string | null;
  filters: unknown;
  visibility: string;
  applied_count: string | number | null;
  shared_count: string | number | null;
  last_applied_at: string | null;
  last_shared_at: string | null;
  created_at: string;
  updated_at: string;
};
