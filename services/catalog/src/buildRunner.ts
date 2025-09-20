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
  updateRepositoryLaunchEnvTemplates,
  type BuildRecord,
  type LaunchEnvVar
} from './db';

const BUILD_CLONE_DEPTH = process.env.BUILD_CLONE_DEPTH ?? '1';

const git = simpleGit();

const ENV_TEMPLATE_FILES = ['.env.template', '.env.example'];

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

function stripInlineComment(value: string): string {
  if (!value.includes('#')) {
    return value.trim();
  }
  let inSingle = false;
  let inDouble = false;
  let result = '';
  for (const char of value) {
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    }
    if (char === '#' && !inSingle && !inDouble) {
      break;
    }
    result += char;
  }
  return result.trim();
}

function parseEnvTemplate(contents: string): LaunchEnvVar[] {
  const entries: LaunchEnvVar[] = [];
  const seen = new Set<string>();
  const lines = contents.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    let working = trimmed;
    if (working.startsWith('export ')) {
      working = working.slice(7).trim();
    }
    const equalsIndex = working.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }
    const key = working.slice(0, equalsIndex).trim();
    if (!key) {
      continue;
    }
    let value = working.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      value = stripInlineComment(value);
    }
    if (seen.has(key)) {
      continue;
    }
    entries.push({ key, value });
    seen.add(key);
    if (entries.length >= 32) {
      break;
    }
  }
  return entries;
}

async function discoverEnvTemplates(workingDir: string): Promise<LaunchEnvVar[] | null> {
  let emptyTemplate: LaunchEnvVar[] | null = null;
  for (const fileName of ENV_TEMPLATE_FILES) {
    const candidate = path.join(workingDir, fileName);
    if (!(await fileExists(candidate))) {
      continue;
    }
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      const parsed = parseEnvTemplate(raw);
      if (parsed.length > 0) {
        return parsed;
      }
      emptyTemplate = parsed;
    } catch (err) {
      const message = (err as Error).message ?? 'failed to read env template';
      log('Failed to read env template', { fileName, error: message });
      return null;
    }
  }
  return emptyTemplate ?? [];
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
  const pending = await startBuild(buildId);
  if (!pending) {
    log('No build to start or already handled', { buildId });
    return;
  }

  const repository = await getRepositoryById(pending.repositoryId);
  if (!repository) {
    log('Repository missing for build', { buildId, repositoryId: pending.repositoryId });
    await completeBuild(buildId, 'failed', {
      logs: 'Repository metadata no longer available. Build aborted.\n',
      errorMessage: 'repository missing'
    });
    return;
  }

  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-build-'));
  let combinedLogs = pending.logs ?? '';

  let resolvedCommitSha: string | null = pending.commitSha ?? null;

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

    const envTemplates = await discoverEnvTemplates(workingDir);
    if (envTemplates !== null) {
      await updateRepositoryLaunchEnvTemplates(repository.id, envTemplates);
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
      return;
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

    if (exitCode === 0) {
      await completeBuild(buildId, 'succeeded', {
        logs: combinedLogs,
        imageTag,
        errorMessage: '',
        commitSha: resolvedCommitSha,
        gitBranch: pending.gitBranch,
        gitRef: pending.gitRef
      });
      log('Build succeeded', { buildId, imageTag });
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
    log('Build crashed', { buildId, error: message });
  } finally {
    await fs.rm(workingDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
