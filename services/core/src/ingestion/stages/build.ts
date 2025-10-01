import { createBuild as createBuildDefault } from '../../db/index';
import { enqueueBuildJob as enqueueBuildJobDefault } from '../../queue';
import { log } from '../logger';
import type { IngestionPipelineContext, PipelineStage } from '../types';

type BuildStageDeps = {
  createBuild?: typeof createBuildDefault;
  enqueueBuildJob?: typeof enqueueBuildJobDefault;
};

export function createBuildStage(deps: BuildStageDeps = {}): PipelineStage {
  const createBuild = deps.createBuild ?? createBuildDefault;
  const enqueueBuildJob = deps.enqueueBuildJob ?? enqueueBuildJobDefault;

  return {
    name: 'build',
    async run(context: IngestionPipelineContext) {
      const build = await createBuild(context.repository.id, { commitSha: context.commitSha });
      context.buildId = build.id;
      const buildRun = await enqueueBuildJob(build.id, context.repository.id);
      log(context.inlineQueueMode ? 'Running build inline' : 'Enqueuing build job', {
        repositoryId: context.repository.id,
        buildId: build.id,
        jobRunId: buildRun.id
      });
    }
  };
}

export const buildStage = createBuildStage();
export type { BuildStageDeps };
