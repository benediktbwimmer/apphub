import path from 'node:path';
import {
  replaceRepositoryPreviews as replaceRepositoryPreviewsDefault,
  replaceRepositoryTags as replaceRepositoryTagsDefault,
  setRepositoryStatus as setRepositoryStatusDefault,
  upsertRepository as upsertRepositoryDefault
} from '../../db/index';
import type { IngestionPipelineContext, PipelineStage } from '../types';

type PersistenceStageDeps = {
  upsertRepository?: typeof upsertRepositoryDefault;
  replaceRepositoryPreviews?: typeof replaceRepositoryPreviewsDefault;
  replaceRepositoryTags?: typeof replaceRepositoryTagsDefault;
  setRepositoryStatus?: typeof setRepositoryStatusDefault;
};

export function createPersistenceStage(deps: PersistenceStageDeps = {}): PipelineStage {
  const upsertRepository = deps.upsertRepository ?? upsertRepositoryDefault;
  const replaceRepositoryPreviews = deps.replaceRepositoryPreviews ?? replaceRepositoryPreviewsDefault;
  const replaceRepositoryTags = deps.replaceRepositoryTags ?? replaceRepositoryTagsDefault;
  const setRepositoryStatus = deps.setRepositoryStatus ?? setRepositoryStatusDefault;

  return {
    name: 'persistence',
    async run(context: IngestionPipelineContext) {
      if (!context.tagMap) {
        throw new Error('Tag map missing for persistence stage');
      }
      if (!context.workingDir) {
        throw new Error('Working directory missing for persistence stage');
      }

      const now = new Date().toISOString();
      let repositoryName = context.repository.name;

      if (context.shouldAutofillMetadata) {
        const packageJsonRelative = context.packageMetadata?.packageJsonPath
          ? path.relative(context.workingDir, context.packageMetadata.packageJsonPath)
          : null;
        const dockerfileDir = context.dockerfilePath
          ? path.dirname(context.dockerfilePath)
          : '';
        const dockerfileAtRepoRoot = dockerfileDir === '.' || dockerfileDir === '';
        const isRootPackage = packageJsonRelative === 'package.json';
        const packageNameCandidate = context.packageMetadata?.name?.trim();
        const shouldUsePackageName = Boolean(
          packageNameCandidate &&
            !packageNameCandidate.startsWith('@') &&
            (!isRootPackage || dockerfileAtRepoRoot)
        );
        if (shouldUsePackageName && packageNameCandidate) {
          repositoryName = packageNameCandidate;
        }
      }

      let repositoryDescription = context.repository.description;
      if (context.shouldAutofillMetadata) {
        const readmeSummary = context.readmeMetadata?.summary;
        if (readmeSummary) {
          repositoryDescription = readmeSummary;
        }
      }

      const dockerfilePath = context.dockerfilePath ?? context.repository.dockerfilePath;
      const tags = Array.from(context.tagMap.values());

      await upsertRepository({
        id: context.repository.id,
        name: repositoryName,
        description: repositoryDescription,
        repoUrl: context.repository.repoUrl,
        dockerfilePath,
        ingestStatus: 'ready',
        updatedAt: now,
        lastIngestedAt: now,
        ingestError: null,
        tags,
        ingestAttempts: context.repository.ingestAttempts,
        launchEnvTemplates: context.repository.launchEnvTemplates,
        metadataStrategy: context.metadataStrategy
      });

      await replaceRepositoryPreviews(context.repository.id, context.previewTiles);
      await replaceRepositoryTags(context.repository.id, tags, { clearExisting: true });
      await setRepositoryStatus(context.repository.id, 'ready', {
        updatedAt: now,
        lastIngestedAt: now,
        ingestError: null,
        eventMessage: 'Ingestion succeeded',
        commitSha: context.commitSha,
        durationMs: Date.now() - context.processingStartedAt
      });

      context.repositoryName = repositoryName;
      context.repositoryDescription = repositoryDescription;
    }
  };
}

export const persistenceStage = createPersistenceStage();
export type { PersistenceStageDeps };
