import type { KeyboardEventHandler } from 'react';

export type TagKV = {
  key: string;
  value: string;
};

export type BuildStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type BuildSummary = {
  id: string;
  repositoryId: string;
  status: BuildStatus;
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
  logsPreview: string | null;
  logsTruncated: boolean;
  hasLogs: boolean;
  logsSize: number;
};

export type LaunchStatus = 'pending' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';

export type LaunchEnvVar = {
  key: string;
  value: string;
};

export type LaunchRequestDraft = {
  env: LaunchEnvVar[];
  command: string;
  launchId: string;
};

export type LaunchSummary = {
  id: string;
  status: LaunchStatus;
  buildId: string;
  instanceUrl: string | null;
  resourceProfile: string | null;
  env: LaunchEnvVar[];
  command: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  expiresAt: string | null;
  port: number | null;
};

export type PreviewTileKind = 'gif' | 'image' | 'video' | 'storybook' | 'embed';

export type PreviewTile = {
  id: number;
  kind: PreviewTileKind;
  title: string | null;
  description: string | null;
  src: string | null;
  embedUrl: string | null;
  posterUrl: string | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
  source: string;
};

export type BuildListMeta = {
  total: number;
  count: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
  hasMore: boolean;
};

export type BuildLogState = {
  open: boolean;
  loading: boolean;
  error: string | null;
  content: string | null;
  size: number;
  updatedAt: string | null;
};

export type BuildTimelineState = {
  open: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  builds: BuildSummary[];
  meta: BuildListMeta | null;
  logs: Record<string, BuildLogState>;
  retrying: Record<string, boolean>;
  creating: boolean;
  createError: string | null;
};

export type IngestStatus = 'seed' | 'pending' | 'processing' | 'ready' | 'failed';

export type AppRecord = {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  dockerfilePath: string;
  tags: TagKV[];
  updatedAt: string;
  ingestStatus: IngestStatus;
  ingestError: string | null;
  ingestAttempts: number;
  latestBuild: BuildSummary | null;
  latestLaunch: LaunchSummary | null;
  relevance: RelevanceSummary | null;
  previewTiles: PreviewTile[];
};

export type RelevanceComponent = {
  hits: number;
  weight: number;
  score: number;
};

export type RelevanceSummary = {
  score: number;
  normalizedScore: number;
  components: {
    name: RelevanceComponent;
    description: RelevanceComponent;
    tags: RelevanceComponent;
  };
};

export type TagSuggestion = {
  type: 'key' | 'pair';
  value: string;
  label: string;
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

export type SearchSort = 'relevance' | 'updated' | 'name';

export type SearchMeta = {
  tokens: string[];
  sort: SearchSort;
  weights: {
    name: number;
    description: number;
    tags: number;
  };
};

export type IngestionEvent = {
  id: number;
  repositoryId: string;
  status: string;
  message: string | null;
  attempt: number | null;
  commitSha: string | null;
  durationMs: number | null;
  createdAt: string;
};

export type HistoryState = Record<
  string,
  {
    open: boolean;
    loading: boolean;
    error: string | null;
    events: IngestionEvent[] | null;
  }
>;

export type LaunchListState = Record<
  string,
  {
    open: boolean;
    loading: boolean;
    error: string | null;
    launches: LaunchSummary[] | null;
  }
>;

export type CatalogSocketEvent =
  | { type: 'connection.ack'; data: { now: string } }
  | { type: 'pong'; data: { now: string } }
  | { type: 'repository.updated'; data: { repository: AppRecord } }
  | { type: 'repository.ingestion-event'; data: { event: IngestionEvent } }
  | { type: 'build.updated'; data: { build: BuildSummary } }
  | { type: 'launch.updated'; data: { repositoryId: string; launch: LaunchSummary } };

export type SearchParseResult = {
  tags: string[];
  text: string;
};

export type AutocompleteContext = {
  base: string;
  activeToken: string;
};

export type SearchHandlers = {
  onInputChange: (value: string) => void;
  onKeyDown: KeyboardEventHandler<HTMLInputElement>;
  onSortChange: (next: SearchSort) => void;
  onToggleHighlight: (enabled: boolean) => void;
  onApplySuggestion: (suggestion: TagSuggestion) => void;
};
