import type { ManifestEnvVarInput } from '../serviceManifestTypes';

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
  createdAt: string;
};

export type IngestStatus = 'seed' | 'pending' | 'processing' | 'ready' | 'failed';

export const ALL_INGEST_STATUSES: IngestStatus[] = ['seed', 'pending', 'processing', 'ready', 'failed'];

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

export type JobRuntime = 'node' | 'python';

export type JobRetryStrategy = 'none' | 'fixed' | 'exponential';

export type JobRetryPolicy = {
  maxAttempts?: number | null;
  strategy?: JobRetryStrategy;
  initialDelayMs?: number | null;
  maxDelayMs?: number | null;
  jitter?: 'none' | 'full' | 'equal';
};

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
  createdAt: string;
  updatedAt: string;
};

export type JobRunCreateInput = {
  parameters?: JsonValue;
  timeoutMs?: number | null;
  attempt?: number;
  maxAttempts?: number | null;
  context?: JsonValue | null;
  scheduledAt?: string;
};

export type JobRunCompletionInput = {
  result?: JsonValue | null;
  errorMessage?: string | null;
  logsUrl?: string | null;
  metrics?: JsonValue | null;
  context?: JsonValue | null;
  completedAt?: string;
  durationMs?: number | null;
};

export type JobBundleStorageKind = 'local' | 's3';

export type JobBundleVersionStatus = 'published' | 'deprecated';

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
};

export type JobBundleVersionUpdateInput = {
  deprecated?: boolean;
  metadata?: JsonValue | null;
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

export type WorkflowAssetFreshness = {
  maxAgeMs?: number | null;
  ttlMs?: number | null;
  cadenceMs?: number | null;
};

export type WorkflowAssetDeclaration = {
  assetId: string;
  schema?: JsonValue | null;
  freshness?: WorkflowAssetFreshness | null;
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
  parametersSchema: JsonValue;
  defaultParameters: JsonValue;
  outputSchema: JsonValue;
  metadata: JsonValue | null;
  dag: WorkflowDagMetadata;
  scheduleNextRunAt: string | null;
  scheduleLastMaterializedWindow: WorkflowScheduleWindow | null;
  scheduleCatchupCursor: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowScheduleWindow = {
  start: string | null;
  end: string | null;
};

export type WorkflowDefinitionCreateInput = {
  slug: string;
  name: string;
  version?: number;
  description?: string | null;
  steps: WorkflowStepDefinition[];
  triggers?: WorkflowTriggerDefinition[];
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
  parametersSchema?: JsonValue;
  defaultParameters?: JsonValue;
  outputSchema?: JsonValue;
  metadata?: JsonValue | null;
  dag?: WorkflowDagMetadata;
};

export type WorkflowScheduleMetadataUpdateInput = {
  scheduleNextRunAt?: string | null;
  scheduleLastMaterializedWindow?: WorkflowScheduleWindow | null;
  scheduleCatchupCursor?: string | null;
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

export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type WorkflowRunRecord = {
  id: string;
  workflowDefinitionId: string;
  status: WorkflowRunStatus;
  parameters: JsonValue;
  context: JsonValue;
  output: JsonValue | null;
  errorMessage: string | null;
  currentStepId: string | null;
  currentStepIndex: number | null;
  metrics: JsonValue | null;
  triggeredBy: string | null;
  trigger: JsonValue | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRunCreateInput = {
  parameters?: JsonValue;
  triggeredBy?: string | null;
  trigger?: JsonValue | null;
  status?: WorkflowRunStatus;
  context?: JsonValue;
  currentStepId?: string | null;
  currentStepIndex?: number | null;
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
