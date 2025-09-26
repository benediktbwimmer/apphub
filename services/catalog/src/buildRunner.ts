import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import simpleGit from 'simple-git';
import {
  appendBuildLog,
  completeBuild,
  getBuildById,
  getRepositoryById,
  startBuild,
  type BuildRecord,
  type JsonValue
} from './db/index';
import { registerJobHandler, type JobRunContext, type JobResult } from './jobs/runtime';

const BUILD_CLONE_DEPTH = process.env.BUILD_CLONE_DEPTH ?? '1';

const git = simpleGit();

function log(message: string, meta?: Record<string, unknown>) {
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[build] ${message}${payload}`);
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeImageName(source: string) {
  const normalized = source.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-');
  return normalized.replace(/^-+|-+$/g, '') || 'app';
}

function buildImageTag(repositoryId: string, commitSha: string | null) {
  const name = sanitizeImageName(repositoryId);
  const suffix = commitSha ? commitSha.slice(0, 12) : Date.now().toString(36);
  return `apphub/${name}:${suffix}`;
}

function collectProcessOutput(command: string, args: string[], options: { cwd: string }): Promise<{
  exitCode: number | null;
  output: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env
    });

    let output = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
    });

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
    });

    child.on('close', (code) => {
      resolve({ exitCode: code, output });
    });

    child.on('error', (err) => {
      const message = (err as Error).message ?? 'process error';
      output += `\n${message}\n`;
      resolve({ exitCode: null, output });
    });
  });
}

export async function runBuildJob(
  buildId: string,
  options: { jobContext?: JobRunContext } = {}
): Promise<JobResult> {
  const jobContext = options.jobContext ?? null;
  const startedAt = Date.now();

  const pending = await startBuild(buildId);
  if (!pending) {
    log('No build to start or already handled', { buildId });
    const metrics: Record<string, JsonValue> = {
      buildId,
      status: 'skipped'
    };
    if (jobContext) {
      await jobContext.update({ metrics });
    }
    return {
      status: 'succeeded',
      result: { buildId, skipped: true },
      metrics
    };
  }

  const repository = await getRepositoryById(pending.repositoryId);
  if (!repository) {
    log('Repository missing for build', { buildId, repositoryId: pending.repositoryId });
    await completeBuild(buildId, 'failed', {
      logs: 'Repository metadata no longer available. Build aborted.\n',
      errorMessage: 'repository missing'
    });
    const metrics: Record<string, JsonValue> = {
      buildId,
      repositoryId: pending.repositoryId,
      status: 'failed'
    };
    if (jobContext) {
      await jobContext.update({ metrics });
    }
    return {
      status: 'failed',
      errorMessage: 'repository missing',
      metrics
    };
  }

  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-build-'));
  let combinedLogs = pending.logs ?? '';

  let resolvedCommitSha: string | null = pending.commitSha ?? null;
  let finalResult: JobResult = {
    status: 'failed',
    errorMessage: 'build failed'
  };

  try {
    const startLine = `Starting build for ${repository.id}...\n`;
    await appendBuildLog(buildId, startLine);
    combinedLogs += startLine;

    const cloneArgs = ['--depth', BUILD_CLONE_DEPTH];
    if (pending.gitBranch) {
      cloneArgs.push('--branch', pending.gitBranch);
    }
    cloneArgs.push('--single-branch');
    log('Cloning repository for build', {
      buildId,
      repositoryId: repository.id,
      branch: pending.gitBranch ?? undefined
    });
    await git.clone(repository.repoUrl, workingDir, cloneArgs);

    const repoGit = simpleGit(workingDir);
    const checkoutTarget = pending.gitRef ?? pending.commitSha;
    if (checkoutTarget) {
      try {
        await repoGit.checkout(checkoutTarget);
      } catch (err) {
        const message = (err as Error).message ?? 'failed to checkout reference';
        combinedLogs += `Checkout warning: ${message}\n`;
      }
    }

    try {
      const headSha = await repoGit.revparse(['HEAD']);
      if (headSha) {
        resolvedCommitSha = headSha.trim();
      }
    } catch (err) {
      const message = (err as Error).message ?? 'failed to resolve HEAD commit';
      combinedLogs += `Commit resolution warning: ${message}\n`;
    }

    const dockerfilePath = path.join(workingDir, repository.dockerfilePath);
    if (!(await fileExists(dockerfilePath))) {
      const message = `Dockerfile missing at ${repository.dockerfilePath}`;
      combinedLogs += `${message}\n`;
      await completeBuild(buildId, 'failed', {
        logs: combinedLogs,
        errorMessage: message,
        commitSha: resolvedCommitSha,
        gitBranch: pending.gitBranch,
        gitRef: pending.gitRef
      });
      const metrics: Record<string, JsonValue> = {
        buildId,
        repositoryId: repository.id,
        status: 'failed',
        reason: 'missing_dockerfile'
      };
      if (jobContext) {
        await jobContext.update({ metrics });
      }
      return {
        status: 'failed',
        errorMessage: message,
        metrics
      };
    }

    const imageTag = buildImageTag(repository.id, resolvedCommitSha);
    const args = ['build', '-f', dockerfilePath, '-t', imageTag, workingDir];
    log('Running docker build', { buildId, imageTag });
    const commandLine = `$ docker ${args.join(' ')}\n`;
    await appendBuildLog(buildId, commandLine);
    combinedLogs += commandLine;

    const { exitCode, output } = await collectProcessOutput('docker', args, { cwd: workingDir });
    if (output) {
      await appendBuildLog(buildId, output);
      combinedLogs += output;
    }

    const durationMs = Date.now() - startedAt;

    if (exitCode === 0) {
      const completed = await completeBuild(buildId, 'succeeded', {
        logs: combinedLogs,
        imageTag,
        errorMessage: '',
        commitSha: resolvedCommitSha,
        gitBranch: pending.gitBranch,
        gitRef: pending.gitRef
      });
      const metrics: Record<string, JsonValue> = {
        buildId,
        repositoryId: repository.id,
        status: 'succeeded',
        durationMs
      };
      if (resolvedCommitSha) {
        metrics.commitSha = resolvedCommitSha;
      }
      if (completed?.imageTag ?? imageTag) {
        metrics.imageTag = (completed?.imageTag ?? imageTag) as JsonValue;
      }
      if (jobContext) {
        await jobContext.update({ metrics });
      }
      finalResult = {
        status: 'succeeded',
        result: {
          buildId,
          repositoryId: repository.id,
          imageTag: completed?.imageTag ?? imageTag,
          commitSha: resolvedCommitSha
        },
        metrics
      };
      log('Build succeeded', { buildId, imageTag: completed?.imageTag ?? imageTag });
    } else {
      const message = exitCode === null ? 'docker build failed to execute' : `docker build exited with code ${exitCode}`;
      combinedLogs += `${message}\n`;
      await completeBuild(buildId, 'failed', {
        logs: combinedLogs,
        errorMessage: message,
        commitSha: resolvedCommitSha,
        gitBranch: pending.gitBranch,
        gitRef: pending.gitRef
      });
      const metrics: Record<string, JsonValue> = {
        buildId,
        repositoryId: repository.id,
        status: 'failed',
        durationMs,
        exitCode: exitCode ?? null
      };
      if (resolvedCommitSha) {
        metrics.commitSha = resolvedCommitSha;
      }
      if (jobContext) {
        await jobContext.update({ metrics });
      }
      finalResult = {
        status: 'failed',
        errorMessage: message,
        metrics
      };
      log('Build failed', { buildId, exitCode });
    }
  } catch (err) {
    const message = (err as Error).message ?? 'unknown build error';
    combinedLogs += `Unexpected error: ${message}\n`;
    await completeBuild(buildId, 'failed', {
      logs: combinedLogs,
      errorMessage: message,
      commitSha: resolvedCommitSha,
      gitBranch: pending.gitBranch,
      gitRef: pending.gitRef
    });
    const metrics: Record<string, JsonValue> = {
      buildId,
      repositoryId: repository.id,
      status: 'failed',
      durationMs: Date.now() - startedAt
    };
    if (resolvedCommitSha) {
      metrics.commitSha = resolvedCommitSha;
    }
    if (jobContext) {
      await jobContext.update({ metrics });
    }
    finalResult = {
      status: 'failed',
      errorMessage: message,
      metrics
    };
    log('Build crashed', { buildId, error: message });
  } finally {
    await fs.rm(workingDir, { recursive: true, force: true }).catch(() => undefined);
  }

  return finalResult;
}

function resolveBuildParameters(parameters: JsonValue): { buildId: string } {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    throw new Error('buildId parameter is required');
  }
  const value = (parameters as Record<string, JsonValue>).buildId;
  if (typeof value !== 'string') {
    throw new Error('buildId parameter is required');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('buildId parameter is required');
  }
  return { buildId: trimmed };
}

async function buildJobHandler(context: JobRunContext): Promise<JobResult> {
  const { buildId } = resolveBuildParameters(context.parameters);
  return runBuildJob(buildId, { jobContext: context });
}

registerJobHandler('repository-build', buildJobHandler);
