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
