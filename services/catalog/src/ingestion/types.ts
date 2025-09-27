import type { RepositoryPreviewInput, RepositoryRecord, TagKV } from '../db/index';
import type { JobRunContext } from '../jobs/runtime';

export type DiscoveredTag = TagKV & { source: string };

export interface PackageMetadata {
  name?: string;
  description?: string;
  tags: DiscoveredTag[];
  packageJsonPath: string | null;
}

export interface ReadmeMetadata {
  summary: string | null;
  previews: RepositoryPreviewInput[];
}

export interface PipelineStage {
  name: string;
  run: (context: IngestionPipelineContext) => Promise<void>;
}

export interface StageMetrics {
  stage: string;
  durationMs: number;
}

export interface PipelineResult {
  commitSha: string | null;
  metrics: StageMetrics[];
}

export interface IngestionPipelineContext {
  repository: RepositoryRecord;
  jobContext: JobRunContext | null;
  inlineQueueMode: boolean;
  workingDir: string | null;
  commitSha: string | null;
  packageMetadata: PackageMetadata | null;
  declaredTags: DiscoveredTag[];
  readmeMetadata: ReadmeMetadata | null;
  manifestPreviews: RepositoryPreviewInput[];
  previewTiles: RepositoryPreviewInput[];
  dockerfilePath: string | null;
  dockerTags: DiscoveredTag[];
  tagMap: Map<string, DiscoveredTag>;
  repositoryName: string;
  repositoryDescription: string | null;
  metadataStrategy: string;
  shouldAutofillMetadata: boolean;
  stageMetrics: StageMetrics[];
  cleanupTasks: Array<() => Promise<void>>;
  buildId: string | null;
  processingStartedAt: number;
}

export interface PreviewNormalizerOptions {
  projectDir: string;
  repoUrl: string;
  commitSha: string | null;
}
