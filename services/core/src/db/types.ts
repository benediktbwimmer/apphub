import type { ResolvedManifestEnvVar } from '../serviceManifestTypes';
import type { ExampleBundlerProgressStage } from '@apphub/example-bundler';
import type { WorkflowEventCursorPayload } from '@apphub/shared/coreEvents';
import type {
  EventSavedViewAnalytics as SharedEventSavedViewAnalytics,
  EventSavedViewCreateInput as SharedEventSavedViewCreateInput,
  EventSavedViewFilters as SharedEventSavedViewFilters,
  EventSavedViewOwner as SharedEventSavedViewOwner,
  EventSavedViewRecord as SharedEventSavedViewRecord,
  EventSavedViewUpdateInput as SharedEventSavedViewUpdateInput,
  EventSavedViewVisibility as SharedEventSavedViewVisibility
} from '@apphub/shared/eventsExplorer';

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
  internalPort: number | null;
  containerIp: string | null;
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
  env: ResolvedManifestEnvVar[];
  dependsOn: string[];
  createdAt: string;
  updatedAt: string;
};

export type ServiceNetworkRecord = {
  repositoryId: string;
  manifestSource: string | null;
  moduleId: string | null;
  moduleVersion: number | null;
  version: number;
  definition: JsonValue | null;
  checksum: string | null;
  createdAt: string;
  updatedAt: string;
  members: ServiceNetworkMemberRecord[];
};

export type ServiceNetworkMemberInput = {
  memberRepositoryId: string;
  launchOrder?: number;
  waitForBuild?: boolean;
  env?: ResolvedManifestEnvVar[];
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
  createdAt: string;
};

export type IngestStatus = 'seed' | 'pending' | 'processing' | 'ready' | 'failed';

export const ALL_INGEST_STATUSES: IngestStatus[] = ['seed', 'pending', 'processing', 'ready', 'failed'];

export type RepositoryMetadataStrategy = 'auto' | 'explicit';

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
  metadataStrategy?: RepositoryMetadataStrategy;
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
  metadataStrategy: RepositoryMetadataStrategy;
  launchEnvTemplates: LaunchEnvVar[];
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

export type SavedSearchVisibility = 'private';

export type SavedSearchRecord = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  searchInput: string;
  statusFilters: string[];
  sort: string;
  category: string;
  config: JsonValue;
  visibility: SavedSearchVisibility;
  appliedCount: number;
  sharedCount: number;
  lastAppliedAt: string | null;
  lastSharedAt: string | null;
  createdAt: string;
  updatedAt: string;
  ownerKey: string;
  ownerSubject: string;
  ownerKind: 'user' | 'service';
  ownerUserId: string | null;
};

export type EventSavedViewFilters = SharedEventSavedViewFilters;
export type EventSavedViewVisibility = SharedEventSavedViewVisibility;
export type EventSavedViewRecord = SharedEventSavedViewRecord;
export type EventSavedViewCreateInput = SharedEventSavedViewCreateInput;
export type EventSavedViewUpdateInput = SharedEventSavedViewUpdateInput;
export type EventSavedViewOwner = SharedEventSavedViewOwner;
export type EventSavedViewAnalytics = SharedEventSavedViewAnalytics;

export type SavedSearchCreateInput = {
  name: string;
  description?: string | null;
  searchInput?: string;
  statusFilters?: string[];
  sort?: string;
  category?: string;
  config?: JsonValue;
};

export type SavedSearchUpdateInput = {
  name?: string;
  description?: string | null;
  searchInput?: string;
  statusFilters?: string[];
  sort?: string;
  category?: string;
  config?: JsonValue;
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

export type WorkflowEventRecord = {
  id: string;
  type: string;
  source: string;
  occurredAt: string;
  receivedAt: string;
  payload: JsonValue;
  correlationId: string | null;
  ttlMs: number | null;
  metadata: JsonValue | null;
};

export type WorkflowEventInsert = {
  id: string;
  type: string;
  source: string;
  occurredAt: string;
  payload: JsonValue;
  correlationId?: string | null;
  ttlMs?: number | null;
  metadata?: JsonValue | null;
  receivedAt?: string;
};

export type WorkflowEventCursor = WorkflowEventCursorPayload;

export type WorkflowEventQueryOptions = {
  type?: string | null;
  source?: string | null;
  correlationId?: string | null;
  from?: string | null;
  to?: string | null;
  jsonPath?: string | null;
  limit?: number;
  cursor?: WorkflowEventCursor | null;
};

export type WorkflowEventQueryResult = {
  events: WorkflowEventRecord[];
  limit: number;
  hasMore: boolean;
  nextCursor: WorkflowEventCursor | null;
};

export type WorkflowEventProducerSampleRecord = {
  workflowDefinitionId: string;
  workflowRunStepId: string;
  jobSlug: string;
  eventType: string;
  eventSource: string;
  sampleCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  expiresAt: string | null;
  cleanupAttemptedAt: string | null;
};

export type WorkflowEventProducerSampleUpsert = {
  workflowDefinitionId: string;
  workflowRunStepId: string;
  jobSlug: string;
  eventType: string;
  eventSource: string;
  observedAt: string;
  ttlMs?: number | null;
};

export type WorkflowEventProducerSampleSummary = {
  jobSlug: string;
  eventType: string;
  eventSource: string;
  sampleCount: number;
  distinctWorkflows: number;
  workflowDefinitionIds: string[];
  lastSeenAt: string;
};

export type WorkflowEventProducerSamplingSnapshot = {
  totals: {
    rows: number;
    sampleCount: number;
  };
  perJob: WorkflowEventProducerSampleSummary[];
  stale: WorkflowEventProducerSampleRecord[];
  staleBefore: string | null;
  staleCount: number;
  replay: WorkflowEventProducerSamplingReplayState;
  generatedAt: string;
};

export type WorkflowEventProducerInferenceEdge = {
  workflowDefinitionId: string;
  stepId: string;
  eventType: string;
  eventSource: string | null;
  sampleCount: number;
  lastSeenAt: string;
};

export type WorkflowEventSamplingReplayMetrics = {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  lastProcessedAt: string | null;
  lastFailure: {
    eventId: string;
    attempts: number;
    error: string | null;
    updatedAt: string;
  } | null;
};

export type WorkflowEventProducerSamplingReplayState = {
  metrics: WorkflowEventSamplingReplayMetrics;
  pending: number;
  lookback: {
    from: string | null;
    to: string;
  };
};

export type ServiceStatus = 'unknown' | 'healthy' | 'degraded' | 'unreachable';

export type ServiceKind = string;

export type ServiceSource = 'external' | 'module';

export type ServiceRecord = {
  id: string;
  slug: string;
  displayName: string;
  kind: ServiceKind;
  baseUrl: string;
  source: ServiceSource;
  status: ServiceStatus;
  statusMessage: string | null;
  capabilities: JsonValue | null;
  metadata: JsonValue | null;
  lastHealthyAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ServiceManifestStoreRecord = {
  id: number;
  moduleId: string;
  moduleVersion: number;
  serviceSlug: string;
  definition: JsonValue;
  checksum: string;
  createdAt: string;
  updatedAt: string;
  supersededAt: string | null;
};

export type ServiceManifestStoreInput = {
  serviceSlug: string;
  definition: JsonValue;
  checksum: string;
};

export type ServiceHealthSnapshotRecord = {
  id: number;
  serviceSlug: string;
  version: number;
  status: ServiceStatus;
  statusMessage: string | null;
  latencyMs: number | null;
  statusCode: number | null;
  checkedAt: string;
  baseUrl: string | null;
  healthEndpoint: string | null;
  metadata: JsonValue | null;
  createdAt: string;
  updatedAt: string;
};

export type ServiceHealthSnapshotInsert = {
  serviceSlug: string;
  status: ServiceStatus;
  statusMessage?: string | null;
  latencyMs?: number | null;
  statusCode?: number | null;
  checkedAt: string;
  baseUrl?: string | null;
  healthEndpoint?: string | null;
  metadata?: JsonValue | null;
};

export type ServiceUpsertInput = {
  slug: string;
  displayName: string;
  kind: ServiceKind;
  baseUrl: string;
  source?: ServiceSource;
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

export type JobType = 'batch' | 'service-triggered' | 'manual';

export type JobRuntime = 'node' | 'python' | 'docker' | 'module';

export type JobRetryStrategy = 'none' | 'fixed' | 'exponential';

export type JobRetryPolicy = {
  maxAttempts?: number | null;
  strategy?: JobRetryStrategy;
  initialDelayMs?: number | null;
  maxDelayMs?: number | null;
  jitter?: 'none' | 'full' | 'equal';
};

export type DockerJobEnvironmentVariable = {
  name: string;
  value?: string | null;
  secret?: SecretReference | null;
};

export type DockerJobConfigFileSpec = {
  filename: string;
  mountPath?: string | null;
  format?: 'json' | 'yaml' | 'text' | 'binary';
};

export type DockerJobInputSource =
  | {
      type: 'filestoreNode';
      nodeId: string | number;
    }
  | {
      type: 'filestorePath';
      backendMountId: number;
      path: string;
    };

export type DockerJobInputDescriptor = {
  id?: string;
  source: DockerJobInputSource;
  workspacePath: string;
  mountPath?: string | null;
  optional?: boolean;
  writable?: boolean;
};

export type DockerJobOutputUploadTarget = {
  backendMountId: number;
  pathTemplate: string;
  contentType?: string | null;
  mode?: 'file' | 'directory';
  overwrite?: boolean;
};

export type DockerJobOutputDescriptor = {
  id?: string;
  workspacePath: string;
  upload: DockerJobOutputUploadTarget;
  optional?: boolean;
};

export type DockerJobMetadata = {
  docker: {
    image: string;
    imagePullPolicy?: 'always' | 'ifNotPresent';
    platform?: string | null;
    entryPoint?: string[];
    command?: string[];
    args?: string[];
    workingDirectory?: string | null;
    workspaceMountPath?: string | null;
    networkMode?: 'none' | 'bridge';
    requiresGpu?: boolean;
    environment?: DockerJobEnvironmentVariable[];
    configFile?: DockerJobConfigFileSpec | null;
    inputs?: DockerJobInputDescriptor[];
    outputs?: DockerJobOutputDescriptor[];
  };
} & Record<string, JsonValue>;

export type JobDefinitionRecord = {
  id: string;
  slug: string;
  name: string;
  version: number;
  type: JobType;
  runtime: JobRuntime;
  entryPoint: string;
  parametersSchema: JsonValue;
  defaultParameters: JsonValue;
  outputSchema: JsonValue;
  timeoutMs: number | null;
  retryPolicy: JobRetryPolicy | null;
  metadata: JsonValue | null;
  moduleBinding: ModuleTargetBinding | null;
  createdAt: string;
  updatedAt: string;
};

export type JobDefinitionCreateInput = {
  slug: string;
  name: string;
  type: JobType;
  runtime?: JobRuntime;
  entryPoint: string;
  version?: number;
  parametersSchema?: JsonValue;
  defaultParameters?: JsonValue;
  outputSchema?: JsonValue;
  timeoutMs?: number | null;
  retryPolicy?: JobRetryPolicy | null;
  metadata?: JsonValue | null;
  moduleBinding?: ModuleTargetBinding | null;
};

export type JobRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'expired';

export type JobRunRecord = {
  id: string;
  jobDefinitionId: string;
  status: JobRunStatus;
  parameters: JsonValue;
  result: JsonValue | null;
  errorMessage: string | null;
  logsUrl: string | null;
  metrics: JsonValue | null;
  context: JsonValue | null;
  timeoutMs: number | null;
  attempt: number;
  maxAttempts: number | null;
  durationMs: number | null;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastHeartbeatAt: string | null;
  retryCount: number;
  failureReason: string | null;
  moduleBinding: ModuleTargetBinding | null;
  createdAt: string;
  updatedAt: string;
};

export type JobRunWithDefinition = {
  run: JobRunRecord;
  job: {
    id: string;
    slug: string;
    name: string;
    version: number;
    type: JobType;
    runtime: JobRuntime;
    moduleBinding: ModuleTargetBinding | null;
  };
};

export type JobRunCreateInput = {
  parameters?: JsonValue;
  timeoutMs?: number | null;
  attempt?: number;
  maxAttempts?: number | null;
  context?: JsonValue | null;
  scheduledAt?: string;
  retryCount?: number;
  lastHeartbeatAt?: string | null;
  failureReason?: string | null;
  moduleBinding?: ModuleTargetBinding | null;
};

export type JobRunCompletionInput = {
  result?: JsonValue | null;
  errorMessage?: string | null;
  logsUrl?: string | null;
  metrics?: JsonValue | null;
  context?: JsonValue | null;
  completedAt?: string;
  durationMs?: number | null;
  failureReason?: string | null;
  retryCount?: number;
};

export type JobBundleStorageKind = 'local' | 's3';

export type JobBundleVersionStatus = 'published' | 'deprecated';

export type ModuleTargetBinding = {
  moduleId: string;
  moduleVersion: string;
  moduleArtifactId: string | null;
  targetName: string;
  targetVersion: string;
  targetFingerprint: string | null;
};

export type JobBundleRecord = {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  latestVersion: string | null;
  createdAt: string;
  updatedAt: string;
  versions?: JobBundleVersionRecord[];
};

export type JobBundleVersionRecord = {
  id: string;
  bundleId: string;
  slug: string;
  version: string;
  manifest: JsonValue;
  checksum: string;
  capabilityFlags: string[];
  artifactStorage: JobBundleStorageKind;
  artifactPath: string;
  artifactContentType: string | null;
  artifactSize: number | null;
  immutable: boolean;
  status: JobBundleVersionStatus;
  publishedBy: string | null;
  publishedByKind: string | null;
  publishedByTokenHash: string | null;
  publishedAt: string;
  deprecatedAt: string | null;
  replacedAt: string | null;
  replacedBy: string | null;
  metadata: JsonValue | null;
  createdAt: string;
  updatedAt: string;
};

export type JobBundlePublishInput = {
  slug: string;
  displayName?: string | null;
  description?: string | null;
  version: string;
  manifest: JsonValue;
  capabilityFlags?: string[];
  checksum: string;
  artifactStorage: JobBundleStorageKind;
  artifactPath: string;
  artifactContentType?: string | null;
  artifactSize?: number | null;
  artifactData?: Buffer | null;
  immutable?: boolean;
  metadata?: JsonValue | null;
  publishedBy?: string | null;
  publishedByKind?: string | null;
  publishedByTokenHash?: string | null;
  force?: boolean;
};

export type JobBundleVersionUpdateInput = {
  deprecated?: boolean;
  metadata?: JsonValue | null;
};

export type ExampleBundleStorageKind = JobBundleStorageKind;

export type ExampleBundleState = 'queued' | 'running' | 'completed' | 'failed';

export type ModuleTargetValueDescriptorMetadata = {
  defaults?: JsonValue;
  hasResolve: boolean;
};

export type ModuleTargetWorkflowMetadata = {
  definition: JsonValue;
  triggers: JsonValue;
  schedules: JsonValue;
};

export type ModuleTargetServiceMetadata = {
  registration?: JsonValue;
};

export type ModuleTargetMetadata = {
  settings?: ModuleTargetValueDescriptorMetadata;
  secrets?: ModuleTargetValueDescriptorMetadata;
  parameters?: ModuleTargetValueDescriptorMetadata;
  workflow?: ModuleTargetWorkflowMetadata;
  service?: ModuleTargetServiceMetadata;
};

export type ModuleTargetKind = 'job' | 'service' | 'workflow';

export type ModuleTargetRecord = {
  id: string;
  moduleId: string;
  moduleVersion: string;
  artifactId: string;
  name: string;
  kind: ModuleTargetKind;
  version: string;
  fingerprint: string;
  displayName: string | null;
  description: string | null;
  capabilityOverrides: string[];
  metadata: ModuleTargetMetadata;
  createdAt: string;
};

export type ModuleTargetRuntimeConfigRecord = {
  moduleId: string;
  moduleVersion: string;
  targetName: string;
  targetVersion: string;
  settings: JsonValue;
  secrets: JsonValue;
  metadata: JsonValue | null;
  createdAt: string;
  updatedAt: string;
};

export type ModuleArtifactRecord = {
  id: string;
  moduleId: string;
  version: string;
  manifest: JsonValue;
  artifactChecksum: string;
  artifactPath: string;
  artifactStorage: string;
  artifactContentType: string | null;
  artifactSize: number | null;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  targets?: ModuleTargetRecord[];
};

export type ModuleRecord = {
  id: string;
  displayName: string | null;
  description: string | null;
  keywords: string[];
  latestVersion: string | null;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ExampleBundleArtifactRecord = {
  id: string;
  slug: string;
  fingerprint: string;
  version: string | null;
  checksum: string;
  filename: string | null;
  storageKind: ExampleBundleStorageKind;
  storageKey: string;
  storageUrl: string | null;
  contentType: string | null;
  size: number | null;
  jobId: string | null;
  uploadedAt: string;
  createdAt: string;
};

export type ExampleBundleStatusRecord = {
  slug: string;
  fingerprint: string;
  stage: ExampleBundlerProgressStage;
  state: ExampleBundleState;
  jobId: string | null;
  version: string | null;
  checksum: string | null;
  filename: string | null;
  cached: boolean | null;
  error: string | null;
  message: string | null;
  artifactId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  artifact: ExampleBundleArtifactRecord | null;
};

export type WorkflowTriggerScheduleDefinition = {
  cron: string;
  timezone?: string | null;
  startWindow?: string | null;
  endWindow?: string | null;
  catchUp?: boolean;
};

export type WorkflowTriggerDefinition = {
  type: string;
  options?: JsonValue | null;
  schedule?: WorkflowTriggerScheduleDefinition;
};

export type WorkflowEventTriggerStatus = 'active' | 'disabled';

export type WorkflowEventTriggerPredicate =
  | {
      type: 'jsonPath';
      path: string;
      operator: 'exists';
    }
  | {
      type: 'jsonPath';
      path: string;
      operator: 'equals' | 'notEquals';
      value: JsonValue;
      caseSensitive?: boolean;
    }
  | {
      type: 'jsonPath';
      path: string;
      operator: 'in' | 'notIn';
      values: JsonValue[];
      caseSensitive?: boolean;
    }
  | {
      type: 'jsonPath';
      path: string;
      operator: 'gt' | 'gte' | 'lt' | 'lte';
      value: number;
    }
  | {
      type: 'jsonPath';
      path: string;
      operator: 'contains';
      value: JsonValue;
      caseSensitive?: boolean;
    }
  | {
      type: 'jsonPath';
      path: string;
      operator: 'regex';
      value: string;
      caseSensitive?: boolean;
      flags?: string;
    };

export type WorkflowEventTriggerRecord = {
  id: string;
  workflowDefinitionId: string;
  version: number;
  status: WorkflowEventTriggerStatus;
  name: string | null;
  description: string | null;
  eventType: string;
  eventSource: string | null;
  predicates: WorkflowEventTriggerPredicate[];
  parameterTemplate: JsonValue | null;
  runKeyTemplate: string | null;
  throttleWindowMs: number | null;
  throttleCount: number | null;
  maxConcurrency: number | null;
  idempotencyKeyExpression: string | null;
  metadata: JsonValue | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
};

export type WorkflowEventTriggerCreateInput = {
  workflowDefinitionId: string;
  name?: string | null;
  description?: string | null;
  eventType: string;
  eventSource?: string | null;
  predicates?: WorkflowEventTriggerPredicate[];
  parameterTemplate?: JsonValue | null;
  runKeyTemplate?: string | null;
  throttleWindowMs?: number | null;
  throttleCount?: number | null;
  maxConcurrency?: number | null;
  idempotencyKeyExpression?: string | null;
  metadata?: JsonValue | null;
  status?: WorkflowEventTriggerStatus;
  createdBy?: string | null;
};

export type WorkflowEventTriggerUpdateInput = {
  name?: string | null;
  description?: string | null;
  eventType?: string;
  eventSource?: string | null;
  predicates?: WorkflowEventTriggerPredicate[];
  parameterTemplate?: JsonValue | null;
  runKeyTemplate?: string | null;
  throttleWindowMs?: number | null;
  throttleCount?: number | null;
  maxConcurrency?: number | null;
  idempotencyKeyExpression?: string | null;
  metadata?: JsonValue | null;
  status?: WorkflowEventTriggerStatus;
  updatedBy?: string | null;
};

export type WorkflowEventTriggerListOptions = {
  workflowDefinitionId?: string;
  status?: WorkflowEventTriggerStatus | null;
  eventType?: string | null;
  eventSource?: string | null;
};

export type WorkflowTriggerDeliveryStatus =
  | 'pending'
  | 'matched'
  | 'throttled'
  | 'skipped'
  | 'launched'
  | 'failed';

export type RetryState = 'pending' | 'scheduled' | 'completed' | 'cancelled';

export type WorkflowTriggerDeliveryRecord = {
  id: string;
  triggerId: string;
  workflowDefinitionId: string;
  eventId: string;
  status: WorkflowTriggerDeliveryStatus;
  attempts: number;
  lastError: string | null;
  workflowRunId: string | null;
  dedupeKey: string | null;
  nextAttemptAt: string | null;
  throttledUntil: string | null;
  retryState: RetryState;
  retryAttempts: number;
  retryMetadata: JsonValue | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowTriggerDeliveryInsert = {
  triggerId: string;
  workflowDefinitionId: string;
  eventId: string;
  status: WorkflowTriggerDeliveryStatus;
  attempts?: number;
  lastError?: string | null;
  workflowRunId?: string | null;
  dedupeKey?: string | null;
  nextAttemptAt?: string | null;
  throttledUntil?: string | null;
  retryState?: RetryState;
  retryAttempts?: number;
  retryMetadata?: JsonValue | null;
};

export type WorkflowTriggerDeliveryUpdateInput = {
  status?: WorkflowTriggerDeliveryStatus;
  attempts?: number;
  lastError?: string | null;
  workflowRunId?: string | null;
  dedupeKey?: string | null;
  nextAttemptAt?: string | null;
  throttledUntil?: string | null;
  retryState?: RetryState;
  retryAttempts?: number;
  retryMetadata?: JsonValue | null;
};

export type WorkflowTriggerDeliveryListOptions = {
  triggerId?: string;
  eventId?: string;
  status?: WorkflowTriggerDeliveryStatus;
  limit?: number;
  dedupeKey?: string | null;
};

export type EventIngressRetryRecord = {
  eventId: string;
  source: string;
  retryState: RetryState;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  metadata: JsonValue | null;
  createdAt: string;
  updatedAt: string;
};

export type EventIngressRetryUpsertInput = {
  eventId: string;
  source: string;
  nextAttemptAt: string;
  retryState?: RetryState;
  attempts?: number;
  lastError?: string | null;
  metadata?: JsonValue | null;
};

export type EventIngressRetryUpdateInput = {
  retryState?: RetryState;
  attempts?: number;
  nextAttemptAt?: string;
  lastError?: string | null;
  metadata?: JsonValue | null;
};

export type WorkflowScheduleWindow = {
  start: string | null;
  end: string | null;
};

export type WorkflowScheduleRecord = {
  id: string;
  workflowDefinitionId: string;
  name: string | null;
  description: string | null;
  cron: string;
  timezone: string | null;
  parameters: JsonValue | null;
  startWindow: string | null;
  endWindow: string | null;
  catchUp: boolean;
  nextRunAt: string | null;
  lastMaterializedWindow: WorkflowScheduleWindow | null;
  catchupCursor: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowScheduleCreateInput = {
  workflowDefinitionId: string;
  name?: string | null;
  description?: string | null;
  cron: string;
  timezone?: string | null;
  parameters?: JsonValue | null;
  startWindow?: string | null;
  endWindow?: string | null;
  catchUp?: boolean;
  isActive?: boolean;
};

export type WorkflowScheduleUpdateInput = {
  name?: string | null;
  description?: string | null;
  cron?: string;
  timezone?: string | null;
  parameters?: JsonValue | null;
  startWindow?: string | null;
  endWindow?: string | null;
  catchUp?: boolean;
  isActive?: boolean;
};

export type WorkflowScheduleWithDefinition = {
  schedule: WorkflowScheduleRecord;
  workflow: WorkflowDefinitionRecord;
};

export type WorkflowAssetFreshness = {
  maxAgeMs?: number | null;
  ttlMs?: number | null;
  cadenceMs?: number | null;
};

export type WorkflowAssetAutoMaterialize = {
  onUpstreamUpdate?: boolean | null;
  priority?: number | null;
  parameterDefaults?: JsonValue | null;
};

export type WorkflowAssetPartitioning =
  | {
      type: 'timeWindow';
      granularity: 'minute' | 'hour' | 'day' | 'week' | 'month';
      timezone?: string | null;
      format?: string | null;
      lookbackWindows?: number | null;
    }
  | {
      type: 'static';
      keys: string[];
    }
  | {
      type: 'dynamic';
      maxKeys?: number | null;
      retentionDays?: number | null;
    };

export type WorkflowAssetDeclaration = {
  assetId: string;
  schema?: JsonValue | null;
  freshness?: WorkflowAssetFreshness | null;
  autoMaterialize?: WorkflowAssetAutoMaterialize | null;
  partitioning?: WorkflowAssetPartitioning | null;
};

export type WorkflowDefinitionStepBase = {
  id: string;
  name: string;
  description?: string | null;
  dependsOn?: string[];
  dependents?: string[];
  produces?: WorkflowAssetDeclaration[];
  consumes?: WorkflowAssetDeclaration[];
};

export type WorkflowDagMetadata = {
  adjacency: Record<string, string[]>;
  roots: string[];
  topologicalOrder: string[];
  edges: number;
};

export type SecretReference =
  | {
      source: 'env';
      key: string;
    }
  | {
      source: 'store';
      key: string;
      version?: string | null;
    };

export type WorkflowServiceRequestHeaderValue =
  | string
  | {
      secret: SecretReference;
      prefix?: string;
    };

export type WorkflowServiceRequestDefinition = {
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, WorkflowServiceRequestHeaderValue>;
  query?: Record<string, string | number | boolean>;
  body?: JsonValue | null;
};

export type WorkflowJobStepBundle = {
  strategy: 'latest' | 'pinned';
  slug: string;
  version?: string | null;
  exportName?: string | null;
};

export type WorkflowJobStepDefinition = WorkflowDefinitionStepBase & {
  type: 'job';
  jobSlug: string;
  parameters?: JsonValue;
  timeoutMs?: number | null;
  retryPolicy?: JobRetryPolicy | null;
  storeResultAs?: string;
  bundle?: WorkflowJobStepBundle | null;
};

export type WorkflowServiceStepDefinition = WorkflowDefinitionStepBase & {
  type: 'service';
  serviceSlug: string;
  parameters?: JsonValue;
  timeoutMs?: number | null;
  retryPolicy?: JobRetryPolicy | null;
  requireHealthy?: boolean;
  allowDegraded?: boolean;
  captureResponse?: boolean;
  storeResponseAs?: string;
  request: WorkflowServiceRequestDefinition;
};

export type WorkflowFanOutTemplateDefinition =
  | (WorkflowJobStepDefinition & { id: string })
  | (WorkflowServiceStepDefinition & { id: string });

export type WorkflowFanOutStepDefinition = WorkflowDefinitionStepBase & {
  type: 'fanout';
  collection: JsonValue | string;
  template: WorkflowFanOutTemplateDefinition;
  maxItems?: number | null;
  maxConcurrency?: number | null;
  storeResultsAs?: string;
};

export type WorkflowStepDefinition =
  | WorkflowJobStepDefinition
  | WorkflowServiceStepDefinition
  | WorkflowFanOutStepDefinition;

export type WorkflowDefinitionRecord = {
  id: string;
  slug: string;
  name: string;
  version: number;
  description: string | null;
  steps: WorkflowStepDefinition[];
  triggers: WorkflowTriggerDefinition[];
  eventTriggers: WorkflowEventTriggerRecord[];
  parametersSchema: JsonValue;
  defaultParameters: JsonValue;
  outputSchema: JsonValue;
  metadata: JsonValue | null;
  dag: WorkflowDagMetadata;
  schedules: WorkflowScheduleRecord[];
  createdAt: string;
  updatedAt: string;
};

export type WorkflowDefinitionCreateInput = {
  slug: string;
  name: string;
  version?: number;
  description?: string | null;
  steps: WorkflowStepDefinition[];
  triggers?: WorkflowTriggerDefinition[];
  eventTriggers?: WorkflowEventTriggerRecord[];
  parametersSchema?: JsonValue;
  defaultParameters?: JsonValue;
  outputSchema?: JsonValue;
  metadata?: JsonValue | null;
  dag?: WorkflowDagMetadata;
};

export type WorkflowDefinitionUpdateInput = {
  name?: string;
  version?: number;
  description?: string | null;
  steps?: WorkflowStepDefinition[];
  triggers?: WorkflowTriggerDefinition[];
  eventTriggers?: WorkflowEventTriggerRecord[];
  parametersSchema?: JsonValue;
  defaultParameters?: JsonValue;
  outputSchema?: JsonValue;
  metadata?: JsonValue | null;
  dag?: WorkflowDagMetadata;
};

export type WorkflowAssetDirection = 'produces' | 'consumes';

export type WorkflowAssetDeclarationRecord = {
  id: string;
  workflowDefinitionId: string;
  stepId: string;
  direction: WorkflowAssetDirection;
  assetId: string;
  schema: JsonValue | null;
  freshness: WorkflowAssetFreshness | null;
  autoMaterialize: WorkflowAssetAutoMaterialize | null;
  partitioning: WorkflowAssetPartitioning | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRunStepAssetRecord = {
  id: string;
  workflowDefinitionId: string;
  workflowRunId: string;
  workflowRunStepId: string;
  stepId: string;
  assetId: string;
  payload: JsonValue | null;
  schema: JsonValue | null;
  freshness: WorkflowAssetFreshness | null;
  partitionKey: string | null;
  producedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRunStepAssetInput = {
  assetId: string;
  payload?: JsonValue | null;
  schema?: JsonValue | null;
  freshness?: WorkflowAssetFreshness | null;
  producedAt?: string | null;
  partitionKey?: string | null;
};

export type WorkflowAssetProvenanceRecord = {
  id: string;
  assetId: string;
  assetKey: string;
  workflowDefinitionId: string;
  workflowSlug: string | null;
  stepId: string;
  workflowRunId: string;
  workflowRunStepId: string;
  jobRunId: string | null;
  jobSlug: string | null;
  partitionKey: string | null;
  partitionKeyNormalized: string;
  producedAt: string;
  metadata: JsonValue;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowAssetProvenanceInput = {
  assetId: string;
  workflowDefinitionId: string;
  workflowSlug: string | null;
  stepId: string;
  workflowRunId: string;
  workflowRunStepId: string;
  jobRunId: string | null;
  jobSlug: string | null;
  partitionKey: string | null;
  producedAt: string;
  metadata?: JsonValue;
};

export type WorkflowAssetRecoveryStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type WorkflowAssetRecoveryRequestRecord = {
  id: string;
  assetId: string;
  assetKey: string;
  workflowDefinitionId: string;
  partitionKey: string | null;
  partitionKeyNormalized: string;
  status: WorkflowAssetRecoveryStatus;
  requestedByWorkflowRunId: string;
  requestedByWorkflowRunStepId: string;
  requestedByStepId: string;
  recoveryWorkflowDefinitionId: string | null;
  recoveryWorkflowRunId: string | null;
  recoveryJobRunId: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  metadata: JsonValue;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type WorkflowAssetRecoveryRequestCreateInput = {
  assetId: string;
  workflowDefinitionId: string;
  partitionKey: string | null;
  requestedByWorkflowRunId: string;
  requestedByWorkflowRunStepId: string;
  requestedByStepId: string;
  metadata?: JsonValue;
};

export type WorkflowAssetRecoveryRequestUpdateInput = {
  status?: WorkflowAssetRecoveryStatus;
  recoveryWorkflowDefinitionId?: string | null;
  recoveryWorkflowRunId?: string | null;
  recoveryJobRunId?: string | null;
  attempts?: number;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  metadata?: JsonValue;
  completedAt?: string | null;
};

export type WorkflowAssetSnapshotRecord = {
  asset: WorkflowRunStepAssetRecord;
  workflowRunId: string;
  workflowStepId: string;
  stepStatus: WorkflowRunStepStatus;
  runStatus: WorkflowRunStatus;
  runStartedAt: string | null;
  runCompletedAt: string | null;
};

export type WorkflowAssetPartitionSummary = {
  assetId: string;
  partitionKey: string | null;
  latest: WorkflowAssetSnapshotRecord | null;
  materializationCount: number;
  isStale: boolean;
  staleMetadata: {
    requestedAt: string;
    requestedBy: string | null;
    note: string | null;
  } | null;
  parameters: JsonValue | null;
  parametersSource: string | null;
  parametersCapturedAt: string | null;
  parametersUpdatedAt: string | null;
};

export type WorkflowAssetStalePartitionRecord = {
  workflowDefinitionId: string;
  assetId: string;
  partitionKey: string | null;
  partitionKeyNormalized: string;
  requestedAt: string;
  requestedBy: string | null;
  note: string | null;
};

export type WorkflowAssetPartitionParametersRecord = {
  workflowDefinitionId: string;
  assetId: string;
  partitionKey: string | null;
  partitionKeyNormalized: string;
  parameters: JsonValue;
  source: string;
  capturedAt: string;
  updatedAt: string;
};

export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type WorkflowRunRetrySummary = {
  pendingSteps: number;
  nextAttemptAt: string | null;
  overdueSteps: number;
};

export type WorkflowRunRecord = {
  id: string;
  workflowDefinitionId: string;
  status: WorkflowRunStatus;
  runKey: string | null;
  runKeyNormalized: string | null;
  parameters: JsonValue;
  context: JsonValue;
  output: JsonValue | null;
  errorMessage: string | null;
  currentStepId: string | null;
  currentStepIndex: number | null;
  metrics: JsonValue | null;
  triggeredBy: string | null;
  trigger: JsonValue | null;
  partitionKey: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
  retrySummary: WorkflowRunRetrySummary;
};

export type WorkflowRunWithDefinition = {
  run: WorkflowRunRecord;
  workflow: {
    id: string;
    slug: string;
    name: string;
    version: number;
  };
};

export type WorkflowRunCreateInput = {
  parameters?: JsonValue;
  triggeredBy?: string | null;
  trigger?: JsonValue | null;
  status?: WorkflowRunStatus;
  context?: JsonValue;
  currentStepId?: string | null;
  currentStepIndex?: number | null;
  partitionKey?: string | null;
  runKey?: string | null;
};

export type WorkflowRunUpdateInput = {
  status?: WorkflowRunStatus;
  parameters?: JsonValue;
  context?: JsonValue;
  output?: JsonValue | null;
  contextPatch?: {
    steps?: Record<string, Record<string, JsonValue | null>>;
    shared?: Record<string, JsonValue | null | undefined>;
    lastUpdatedAt?: string;
  };
  errorMessage?: string | null;
  currentStepId?: string | null;
  currentStepIndex?: number | null;
  metrics?: JsonValue | null;
  triggeredBy?: string | null;
  trigger?: JsonValue | null;
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number | null;
  partitionKey?: string | null;
  runKey?: string | null;
};

export type WorkflowRunStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export type WorkflowRunStepRecord = {
  id: string;
  workflowRunId: string;
  stepId: string;
  status: WorkflowRunStepStatus;
  attempt: number;
  jobRunId: string | null;
  input: JsonValue | null;
  output: JsonValue | null;
  errorMessage: string | null;
  logsUrl: string | null;
  metrics: JsonValue | null;
  context: JsonValue | null;
  startedAt: string | null;
  completedAt: string | null;
  parentStepId: string | null;
  fanoutIndex: number | null;
  templateStepId: string | null;
  producedAssets: WorkflowRunStepAssetRecord[];
  lastHeartbeatAt: string | null;
  retryCount: number;
  failureReason: string | null;
  nextAttemptAt: string | null;
  retryState: RetryState;
  retryAttempts: number;
  retryMetadata: JsonValue | null;
  resolutionError: boolean;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRunStepCreateInput = {
  stepId: string;
  status?: WorkflowRunStepStatus;
  attempt?: number;
  jobRunId?: string | null;
  input?: JsonValue | null;
  output?: JsonValue | null;
  errorMessage?: string | null;
  logsUrl?: string | null;
  metrics?: JsonValue | null;
  context?: JsonValue | null;
  startedAt?: string | null;
  completedAt?: string | null;
  parentStepId?: string | null;
  fanoutIndex?: number | null;
  templateStepId?: string | null;
  lastHeartbeatAt?: string | null;
  retryCount?: number;
  failureReason?: string | null;
  nextAttemptAt?: string | null;
  retryState?: RetryState;
  retryAttempts?: number;
  retryMetadata?: JsonValue | null;
  resolutionError?: boolean;
};

export type WorkflowRunStepUpdateInput = {
  status?: WorkflowRunStepStatus;
  attempt?: number;
  jobRunId?: string | null;
  input?: JsonValue | null;
  output?: JsonValue | null;
  errorMessage?: string | null;
  logsUrl?: string | null;
  metrics?: JsonValue | null;
  context?: JsonValue | null;
  startedAt?: string | null;
  completedAt?: string | null;
  parentStepId?: string | null;
  fanoutIndex?: number | null;
  templateStepId?: string | null;
  lastHeartbeatAt?: string | null;
  retryCount?: number;
  failureReason?: string | null;
  nextAttemptAt?: string | null;
  retryState?: RetryState;
  retryAttempts?: number;
  retryMetadata?: JsonValue | null;
  resolutionError?: boolean;
};

export type WorkflowExecutionHistoryRecord = {
  id: string;
  workflowRunId: string;
  workflowRunStepId: string | null;
  stepId: string | null;
  eventType: string;
  eventPayload: JsonValue;
  createdAt: string;
};

export type WorkflowExecutionHistoryEventInput = {
  workflowRunId: string;
  workflowRunStepId?: string | null;
  stepId?: string | null;
  eventType: string;
  eventPayload?: JsonValue;
};

export type AuditLogRecord = {
  id: number;
  actor: string | null;
  actorType: string | null;
  tokenHash: string | null;
  scopes: JsonValue;
  action: string;
  resource: string;
  status: string;
  ip: string | null;
  userAgent: string | null;
  metadata: JsonValue | null;
  createdAt: string;
};

export type AuditLogCreateInput = {
  actor?: string | null;
  actorType?: string | null;
  tokenHash?: string | null;
  scopes?: string[];
  action: string;
  resource: string;
  status: string;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: JsonValue | null;
};

export type RuntimeScalingPolicyRecord = {
  target: string;
  desiredConcurrency: number;
  reason: string | null;
  updatedBy: string | null;
  updatedByKind: 'user' | 'service' | null;
  updatedByTokenHash: string | null;
  metadata: JsonValue | null;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeScalingPolicyUpsertInput = {
  target: string;
  desiredConcurrency: number;
  reason?: string | null;
  updatedBy?: string | null;
  updatedByKind?: 'user' | 'service' | null;
  updatedByTokenHash?: string | null;
  metadata?: JsonValue | null;
};

export type RuntimeScalingAcknowledgementRecord = {
  target: string;
  instanceId: string;
  appliedConcurrency: number;
  status: 'ok' | 'pending' | 'error';
  error: string | null;
  updatedAt: string;
};

export type RuntimeScalingAcknowledgementInput = {
  target: string;
  instanceId: string;
  appliedConcurrency: number;
  status?: 'ok' | 'pending' | 'error';
  error?: string | null;
};
