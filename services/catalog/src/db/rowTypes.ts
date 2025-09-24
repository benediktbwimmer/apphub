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
  schedule_next_run_at: string | null;
  schedule_last_materialized_window: unknown;
  schedule_catchup_cursor: string | null;
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
