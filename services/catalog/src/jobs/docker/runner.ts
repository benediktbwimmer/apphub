import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { stringify as stringifyYaml } from 'yaml';

import { runDockerCommand } from '../../docker';
import type {
  DockerJobMetadata,
  JobDefinitionRecord,
  JobRunRecord,
  JobRunStatus,
  JsonValue,
  SecretReference
} from '../../db/types';
import type { JobResult } from '../runtime';

const WORKSPACE_ROOT_ENV = 'CATALOG_DOCKER_WORKSPACE_ROOT';
const DEFAULT_LOG_LIMIT = Math.max(
  1024,
  Number(process.env.CATALOG_DOCKER_MAX_LOG_CHARS ?? 16384)
);
const DEFAULT_KILL_GRACE_MS = Math.max(
  1000,
  Number(process.env.CATALOG_DOCKER_KILL_GRACE_MS ?? 5000)
);

class BoundedLogBuffer {
  private buffer = '';
  private truncated = 0;

  constructor(private readonly maxChars: number) {}

  append(chunk: string | Buffer | null | undefined): void {
    if (!chunk) {
      return;
    }
    const text = chunk.toString();
    if (!text) {
      return;
    }
    const remaining = this.maxChars - this.buffer.length;
    if (remaining > 0) {
      this.buffer += text.slice(0, remaining);
    }
    if (text.length > remaining) {
      this.truncated += text.length - remaining;
    }
  }

  value(): string {
    return this.buffer;
  }

  truncatedCount(): number {
    return this.truncated;
  }
}

type DockerRunnerDependencies = {
  spawn: typeof spawn;
  runDockerCommand: typeof runDockerCommand;
};

type WorkspacePaths = {
  base: string;
  workDir: string;
  mountSource: string;
};

type BufferedLogs = {
  stdout: string;
  stderr: string;
  stdoutTruncated: number;
  stderrTruncated: number;
};

type DockerCommandPlan = {
  args: string[];
  containerName: string;
  workspaceMountPath: string;
};

type DockerExecutionTelemetry = {
  containerName: string;
  image: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  timedOut: boolean;
  startedAt: string;
  completedAt: string;
  workspacePath: string;
} & BufferedLogs;

export type DockerExecutionResult = {
  jobResult: JobResult;
  telemetry: DockerExecutionTelemetry;
};

function resolveWorkspaceRoot(): string {
  const configured = process.env[WORKSPACE_ROOT_ENV];
  const trimmed = typeof configured === 'string' ? configured.trim() : '';
  if (trimmed) {
    return path.resolve(trimmed);
  }
  return path.join(os.tmpdir(), 'apphub-docker-workspaces');
}

function sanitizeContainerSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'job'
  );
}

function buildContainerName(definition: JobDefinitionRecord, run: JobRunRecord): string {
  const slugSegment = sanitizeContainerSegment(definition.slug);
  const runSegment = sanitizeContainerSegment(run.id);
  const suffix = run.attempt > 1 ? `-${run.attempt}` : '';
  return `apphub-${slugSegment}-${runSegment}${suffix}`.slice(0, 63);
}

async function ensureWorkspace(runId: string): Promise<WorkspacePaths> {
  const root = resolveWorkspaceRoot();
  await mkdir(root, { recursive: true });
  const sanitized = runId.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 24) || 'job';
  const base = await mkdtemp(path.join(root, `run-${sanitized}-`));
  const workDir = path.join(base, 'workspace');
  await mkdir(workDir, { recursive: true });
  const mountSource = path.join(base, 'mount');
  try {
    await symlink(workDir, mountSource, 'junction');
    return { base, workDir, mountSource } satisfies WorkspacePaths;
  } catch {
    return { base, workDir, mountSource: workDir } satisfies WorkspacePaths;
  }
}

async function cleanupWorkspace(paths: WorkspacePaths): Promise<void> {
  await rm(paths.base, { recursive: true, force: true }).catch(() => {});
}

function ensureWithinWorkspace(workDir: string, candidate: string): void {
  const relative = path.relative(workDir, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Workspace path attempts to escape sandbox root');
  }
}

async function resolveWorkspacePath(workDir: string, relative: string): Promise<string> {
  const normalized = path.normalize(relative).replace(/^\.\/+/g, '');
  const absolute = path.resolve(workDir, normalized);
  ensureWithinWorkspace(workDir, absolute);
  await mkdir(path.dirname(absolute), { recursive: true });
  return absolute;
}

async function writeConfigFile(options: {
  spec: DockerJobMetadata['docker']['configFile'];
  workDir: string;
  definition: JobDefinitionRecord;
  run: JobRunRecord;
  parameters: JsonValue;
}): Promise<string> {
  if (!options.spec) {
    throw new Error('Config file spec missing');
  }
  const targetPath = await resolveWorkspacePath(options.workDir, options.spec.filename);
  const document = {
    job: {
      id: options.definition.id,
      slug: options.definition.slug,
      runId: options.run.id,
      attempt: options.run.attempt,
      version: options.definition.version,
    },
    parameters: options.parameters ?? null,
  } satisfies Record<string, JsonValue>;
  const format = options.spec.format ?? 'json';
  let payload: Buffer;
  if (format === 'json') {
    payload = Buffer.from(JSON.stringify(document, null, 2), 'utf8');
  } else if (format === 'yaml') {
    payload = Buffer.from(stringifyYaml(document), 'utf8');
  } else if (format === 'text') {
    const value =
      typeof options.parameters === 'string'
        ? options.parameters
        : JSON.stringify(options.parameters ?? {});
    payload = Buffer.from(value, 'utf8');
  } else if (format === 'binary') {
    payload = Buffer.from(JSON.stringify(document), 'utf8');
  } else {
    throw new Error(`Unsupported config format: ${format}`);
  }
  await writeFile(targetPath, payload);
  return targetPath;
}

async function buildDockerCommand(options: {
  metadata: DockerJobMetadata['docker'];
  paths: WorkspacePaths;
  definition: JobDefinitionRecord;
  run: JobRunRecord;
  parameters: JsonValue;
  resolveSecret: (reference: SecretReference) => string | null | Promise<string | null>;
  logger: (message: string, meta?: Record<string, unknown>) => void;
}): Promise<DockerCommandPlan> {
  const containerName = buildContainerName(options.definition, options.run);
  const args: string[] = ['run', '--rm', '--name', containerName];
  const workspaceMountPath = options.metadata.workspaceMountPath ?? '/workspace';
  args.push('-v', `${options.paths.mountSource}:${workspaceMountPath}:rw`);
  if (options.metadata.networkMode) {
    args.push('--network', options.metadata.networkMode);
  }
  if (options.metadata.platform) {
    args.push('--platform', options.metadata.platform);
  }
  if (options.metadata.imagePullPolicy === 'always') {
    args.push('--pull=always');
  } else if (options.metadata.imagePullPolicy === 'ifNotPresent') {
    args.push('--pull=missing');
  }
  for (const entry of options.metadata.environment ?? []) {
    const name = entry.name.trim();
    if (!name) {
      continue;
    }
    let value = entry.value ?? null;
    if (entry.secret) {
      const resolved = await options.resolveSecret(entry.secret);
      if (resolved === null) {
        throw new Error(
          `Secret ${entry.secret.key} could not be resolved for environment variable ${name}`
        );
      }
      value = resolved;
    }
    args.push('-e', `${name}=${value ?? ''}`);
  }
  let configMountPath: string | null = null;
  if (options.metadata.configFile) {
    const configHostPath = await writeConfigFile({
      spec: options.metadata.configFile,
      workDir: options.paths.workDir,
      definition: options.definition,
      run: options.run,
      parameters: options.parameters,
    });
    if (options.metadata.configFile.mountPath) {
      configMountPath = options.metadata.configFile.mountPath;
      args.push('-v', `${configHostPath}:${configMountPath}:ro`);
    }
  }
  if (options.metadata.inputs) {
    for (const input of options.metadata.inputs) {
      const hostPath = await resolveWorkspacePath(options.paths.workDir, input.workspacePath);
      const mode = input.writable ? 'rw' : 'ro';
      if (input.mountPath) {
        args.push('-v', `${hostPath}:${input.mountPath}:${mode}`);
      }
    }
  }
  if (options.metadata.outputs) {
    for (const output of options.metadata.outputs) {
      await resolveWorkspacePath(options.paths.workDir, output.workspacePath);
    }
  }
  const entryPoint = options.metadata.entryPoint ?? [];
  if (entryPoint.length > 0) {
    args.push('--entrypoint', entryPoint[0]);
  }
  args.push(options.metadata.image);
  const entryPointTail = entryPoint.slice(1);
  const commandParts = [
    ...entryPointTail,
    ...(options.metadata.command ?? []),
    ...(options.metadata.args ?? [])
  ];
  for (const part of commandParts) {
    if (part) {
      args.push(part);
    }
  }
  options.logger('Prepared docker run invocation', {
    containerName,
    image: options.metadata.image,
    workspaceMountPath,
    configMountPath,
  });
  return { args, containerName, workspaceMountPath } satisfies DockerCommandPlan;
}

async function runDockerAndCapture(options: {
  args: string[];
  deps: DockerRunnerDependencies;
  containerName: string;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  timeoutMs: number | null;
}): Promise<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  logs: BufferedLogs;
  startedAt: string;
  completedAt: string;
  durationMs: number;
}> {
  const child = options.deps.spawn('docker', options.args, { env: process.env }) as ChildProcess;
  const stdoutBuffer = new BoundedLogBuffer(DEFAULT_LOG_LIMIT);
  const stderrBuffer = new BoundedLogBuffer(DEFAULT_LOG_LIMIT);
  const startedAt = new Date();
  const startTick = performance.now();
  let timeoutHandle: NodeJS.Timeout | null = null;
  let timedOut = false;

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');

  child.stdout?.on('data', (chunk) => {
    stdoutBuffer.append(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    stderrBuffer.append(chunk);
  });

  const terminateContainer = async () => {
    if (timedOut) {
      return;
    }
    timedOut = true;
    options.logger('Docker job exceeded timeout, attempting to stop container', {
      containerName: options.containerName,
      timeoutMs: options.timeoutMs ?? null,
    });
    try {
      await options.deps.runDockerCommand(['kill', options.containerName]);
    } catch {
      options.logger('Docker kill command failed during timeout handling', {
        containerName: options.containerName,
      });
    }
    try {
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, DEFAULT_KILL_GRACE_MS));
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    } catch {
      // ignore kill errors
    }
  };

  if (options.timeoutMs && options.timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      void terminateContainer();
    }, options.timeoutMs).unref();
  }

  return new Promise((resolve, reject) => {
    child.on('error', (err) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      const completedAt = new Date();
      const durationMs = performance.now() - startTick;
      if (timedOut && code === null) {
        options.logger('Docker container terminated after timeout window', {
          containerName: options.containerName,
        });
      }
      resolve({
        exitCode: code ?? null,
        signal: (signal ?? null) as NodeJS.Signals | null,
        timedOut,
        logs: {
          stdout: stdoutBuffer.value(),
          stderr: stderrBuffer.value(),
          stdoutTruncated: stdoutBuffer.truncatedCount(),
          stderrTruncated: stderrBuffer.truncatedCount(),
        },
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs,
      });
    });
  });
}

/**
 * Executes catalog jobs by launching Docker containers on the local host.
 *
 * The runner expects the Docker CLI to be available on PATH with permissions to
 * create and remove containers. Workspaces are created under the directory
 * specified by `CATALOG_DOCKER_WORKSPACE_ROOT` (falling back to the system temp
 * directory) and are removed after the container exits. Environment variable
 * `CATALOG_DOCKER_MAX_LOG_CHARS` limits the amount of stdout/stderr captured,
 * while `CATALOG_DOCKER_KILL_GRACE_MS` controls the grace period between
 * issuing `docker kill` and forcing termination on timeout.
 */
export class DockerJobRunner {
  constructor(private readonly deps: DockerRunnerDependencies = { spawn, runDockerCommand }) {}

  async execute(options: {
    definition: JobDefinitionRecord;
    run: JobRunRecord;
    metadata: DockerJobMetadata['docker'];
    parameters: JsonValue;
    timeoutMs?: number | null;
    logger: (message: string, meta?: Record<string, unknown>) => void;
    update: (
      updates: {
        parameters?: JsonValue;
        logsUrl?: string | null;
        metrics?: JsonValue | null;
        context?: JsonValue | null;
        timeoutMs?: number | null;
      }
    ) => Promise<JobRunRecord>;
    resolveSecret: (reference: SecretReference) => string | null | Promise<string | null>;
  }): Promise<DockerExecutionResult> {
    const workspace = await ensureWorkspace(options.run.id);
    const timeoutMs = options.timeoutMs ?? null;
    let telemetry: DockerExecutionTelemetry | null = null;
    let containerName: string | null = null;
    try {
      const commandPlan = await buildDockerCommand({
        metadata: options.metadata,
        paths: workspace,
        definition: options.definition,
        run: options.run,
        parameters: options.parameters,
        resolveSecret: options.resolveSecret,
        logger: options.logger,
      });
      containerName = commandPlan.containerName;

      const execution = await runDockerAndCapture({
        args: commandPlan.args,
        deps: this.deps,
        containerName: commandPlan.containerName,
        logger: options.logger,
        timeoutMs,
      });

      const status: JobRunStatus = execution.timedOut
        ? 'expired'
        : execution.exitCode === 0
          ? 'succeeded'
          : 'failed';

      const errorMessage = execution.timedOut
        ? `Docker job exceeded timeout after ${timeoutMs ?? 0}ms`
        : execution.exitCode === 0
          ? null
          : execution.exitCode !== null
            ? `Docker job exited with code ${execution.exitCode}`
            : execution.signal
              ? `Docker job terminated by signal ${execution.signal}`
              : 'Docker job failed';

      telemetry = {
        containerName: commandPlan.containerName,
        image: options.metadata.image,
        exitCode: execution.exitCode,
        signal: execution.signal,
        durationMs: execution.durationMs,
        timedOut: execution.timedOut,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        workspacePath: workspace.workDir,
        ...execution.logs,
      } satisfies DockerExecutionTelemetry;

      const metrics: JsonValue = {
        docker: {
          containerName: commandPlan.containerName,
          image: options.metadata.image,
          exitCode: execution.exitCode,
          signal: execution.signal ?? null,
          durationMs: Math.round(execution.durationMs),
          timedOut: execution.timedOut,
        },
      } satisfies JsonValue;

      const context: JsonValue = {
        docker: {
          stdout: execution.logs.stdout,
          stderr: execution.logs.stderr,
          stdoutTruncated: execution.logs.stdoutTruncated,
          stderrTruncated: execution.logs.stderrTruncated,
          containerName: commandPlan.containerName,
          image: options.metadata.image,
          startedAt: execution.startedAt,
          completedAt: execution.completedAt,
          workspacePath: workspace.workDir,
        },
      } satisfies JsonValue;

      const resultPayload: JsonValue = {
        exitCode: execution.exitCode,
        signal: execution.signal ?? null,
        containerName: commandPlan.containerName,
        image: options.metadata.image,
        timedOut: execution.timedOut,
      } satisfies JsonValue;

      const jobResult: JobResult = {
        status,
        result: status === 'succeeded' ? resultPayload : null,
        errorMessage,
        metrics,
        context,
      } satisfies JobResult;

      await options.update({ metrics, context });

      return {
        jobResult,
        telemetry,
      } satisfies DockerExecutionResult;
    } finally {
      const removeTarget = containerName ?? telemetry?.containerName ?? null;
      if (removeTarget) {
        try {
          await this.deps.runDockerCommand(['rm', '-f', removeTarget]);
        } catch {
          // swallow container cleanup failures
        }
      }
      await cleanupWorkspace(workspace);
    }
  }
}

export const dockerJobRunner = new DockerJobRunner();
