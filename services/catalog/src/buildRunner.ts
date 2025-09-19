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
  type BuildRecord
} from './db';

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

export async function runBuildJob(buildId: string) {
  const pending = startBuild(buildId);
  if (!pending) {
    log('No build to start or already handled', { buildId });
    return;
  }

  const repository = getRepositoryById(pending.repositoryId);
  if (!repository) {
    log('Repository missing for build', { buildId, repositoryId: pending.repositoryId });
    completeBuild(buildId, 'failed', {
      logs: 'Repository metadata no longer available. Build aborted.\n',
      errorMessage: 'repository missing'
    });
    return;
  }

  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-build-'));
  let combinedLogs = pending.logs ?? '';

  try {
    const startLine = `Starting build for ${repository.id}...\n`;
    appendBuildLog(buildId, startLine);
    combinedLogs += startLine;

    log('Cloning repository for build', { buildId, repositoryId: repository.id });
    await git.clone(repository.repoUrl, workingDir, ['--depth', BUILD_CLONE_DEPTH, '--single-branch']);

    if (pending.commitSha) {
      try {
        await simpleGit(workingDir).checkout(pending.commitSha);
      } catch (err) {
        const message = (err as Error).message ?? 'failed to checkout commit';
        combinedLogs += `Checkout warning: ${message}\n`;
      }
    }

    const dockerfilePath = path.join(workingDir, repository.dockerfilePath);
    if (!(await fileExists(dockerfilePath))) {
      const message = `Dockerfile missing at ${repository.dockerfilePath}`;
      combinedLogs += `${message}\n`;
      completeBuild(buildId, 'failed', {
        logs: combinedLogs,
        errorMessage: message
      });
      return;
    }

    const imageTag = buildImageTag(repository.id, pending.commitSha);
    const args = ['build', '-f', dockerfilePath, '-t', imageTag, workingDir];
    log('Running docker build', { buildId, imageTag });
    const commandLine = `$ docker ${args.join(' ')}\n`;
    appendBuildLog(buildId, commandLine);
    combinedLogs += commandLine;

    const { exitCode, output } = await collectProcessOutput('docker', args, { cwd: workingDir });
    if (output) {
      appendBuildLog(buildId, output);
      combinedLogs += output;
    }

    if (exitCode === 0) {
      completeBuild(buildId, 'succeeded', {
        logs: combinedLogs,
        imageTag,
        errorMessage: ''
      });
      log('Build succeeded', { buildId, imageTag });
    } else {
      const message = exitCode === null ? 'docker build failed to execute' : `docker build exited with code ${exitCode}`;
      combinedLogs += `${message}\n`;
      completeBuild(buildId, 'failed', {
        logs: combinedLogs,
        errorMessage: message
      });
      log('Build failed', { buildId, exitCode });
    }
  } catch (err) {
    const message = (err as Error).message ?? 'unknown build error';
    combinedLogs += `Unexpected error: ${message}\n`;
    completeBuild(buildId, 'failed', {
      logs: combinedLogs,
      errorMessage: message
    });
    log('Build crashed', { buildId, error: message });
  } finally {
    await fs.rm(workingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
