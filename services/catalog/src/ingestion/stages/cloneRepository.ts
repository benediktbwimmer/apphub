import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import simpleGit, { type SimpleGit } from 'simple-git';
import { CLONE_DEPTH } from '../config';
import { log } from '../logger';
import type { IngestionPipelineContext, PipelineStage } from '../types';

type CloneStageDeps = {
  gitFactory?: () => SimpleGit;
};

function defaultGitFactory() {
  return simpleGit();
}

export function createCloneRepositoryStage(deps: CloneStageDeps = {}): PipelineStage {
  return {
    name: 'clone',
    async run(context: IngestionPipelineContext) {
      const git = deps.gitFactory ? deps.gitFactory() : defaultGitFactory();
      const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-ingest-'));
      context.workingDir = workingDir;
      log('Processing repository', { id: context.repository.id });

      await git.clone(context.repository.repoUrl, workingDir, ['--depth', CLONE_DEPTH, '--single-branch']);

      const repoGit = simpleGit(workingDir);
      try {
        const commitSha = await repoGit.revparse(['HEAD']);
        context.commitSha = commitSha;
      } catch (err) {
        context.commitSha = null;
        log('Failed to resolve commit SHA', {
          id: context.repository.id,
          error: (err as Error).message
        });
      }

      context.cleanupTasks.push(() => fs.rm(workingDir, { recursive: true, force: true }));
    }
  };
}

export const cloneRepositoryStage = createCloneRepositoryStage();

export type { CloneStageDeps };

/**
 * Legacy export retained for compatibility. Tests should prefer `createCloneRepositoryStage`.
 */
export default cloneRepositoryStage;
