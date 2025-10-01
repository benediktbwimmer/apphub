import { setRepositoryStatus as setRepositoryStatusDefault } from '../db/index';
import type { RepositoryRecord } from '../db/index';
import type { JobRunContext } from '../jobs/runtime';
import { log } from './logger';
import { cloneRepositoryStage } from './stages/cloneRepository';
import { buildStage } from './stages/build';
import { metadataStage } from './stages/metadata';
import { persistenceStage } from './stages/persistence';
import { tagAggregationStage } from './stages/tags';
import type {
  IngestionPipelineContext,
  PipelineResult,
  PipelineStage,
  StageMetrics
} from './types';

export class IngestionPipelineError extends Error {
  constructor(
    message: string,
    public readonly stageMetrics: StageMetrics[],
    public readonly commitSha: string | null,
    options?: { cause?: unknown }
  ) {
    super(message);
    this.name = 'IngestionPipelineError';
    if (options?.cause !== undefined) {
      // @ts-expect-error cause is not in the base lib target yet but supported at runtime
      this.cause = options.cause;
    }
  }
}

export interface ProcessRepositoryOptions {
  jobContext?: JobRunContext;
  inlineQueueMode?: boolean;
  stages?: PipelineStage[];
  setRepositoryStatus?: typeof setRepositoryStatusDefault;
}

const STAGES: PipelineStage[] = [
  cloneRepositoryStage,
  metadataStage,
  tagAggregationStage,
  persistenceStage,
  buildStage
];

export async function processRepository(
  repository: RepositoryRecord,
  options: ProcessRepositoryOptions = {}
): Promise<PipelineResult> {
  const startedAt = Date.now();
  const stages = options.stages ?? STAGES;
  const setRepositoryStatus = options.setRepositoryStatus ?? setRepositoryStatusDefault;
  const context: IngestionPipelineContext = {
    repository,
    jobContext: options.jobContext ?? null,
    inlineQueueMode: options.inlineQueueMode ?? false,
    workingDir: null,
    commitSha: null,
    packageMetadata: null,
    declaredTags: [],
    readmeMetadata: null,
    manifestPreviews: [],
    previewTiles: [],
    dockerfilePath: null,
    dockerTags: [],
    tagMap: new Map(),
    repositoryName: repository.name,
    repositoryDescription: repository.description,
    metadataStrategy: repository.metadataStrategy ?? 'auto',
    shouldAutofillMetadata: (repository.metadataStrategy ?? 'auto') !== 'explicit',
    stageMetrics: [],
    cleanupTasks: [],
    buildId: null,
    processingStartedAt: startedAt
  };

  try {
    for (const stage of stages) {
      const stageStart = Date.now();
      await stage.run(context);
      const durationMs = Date.now() - stageStart;
      context.stageMetrics.push({ stage: stage.name, durationMs });
    }

    log('Repository ingested', { id: repository.id, dockerfilePath: context.dockerfilePath });

    return {
      commitSha: context.commitSha,
      metrics: [...context.stageMetrics]
    };
  } catch (err) {
    const message = (err as Error).message ?? 'Unknown error';
    const failureNow = new Date().toISOString();
    await setRepositoryStatus(repository.id, 'failed', {
      updatedAt: failureNow,
      lastIngestedAt: failureNow,
      ingestError: message.slice(0, 500),
      eventMessage: message,
      durationMs: Date.now() - startedAt,
      commitSha: context.commitSha
    });
    log('Ingestion failed', { id: repository.id, error: message });
    throw new IngestionPipelineError(message, [...context.stageMetrics], context.commitSha, {
      cause: err
    });
  } finally {
    for (const cleanup of context.cleanupTasks.reverse()) {
      try {
        await cleanup();
      } catch (cleanupErr) {
        log('Cleanup task failed', { error: (cleanupErr as Error).message });
      }
    }
  }
}
