import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { stringify as stringifyYaml } from 'yaml';

import { runDockerCommand } from '../../docker';
import { evaluateDockerImagePolicy, getDockerRuntimeConfig } from '../../config/dockerRuntime';
import type { DockerRuntimeConfig } from '../../config/dockerRuntime';
import { getFilestoreClient } from './filestoreClient';
import {
  collectFilestoreOutputs,
  stageFilestoreInputs,
  type CollectFilestoreOutputsResult,
  type StageFilestoreInputsResult
} from './filestoreArtifacts';
import type {
  DockerJobMetadata,
  JobDefinitionRecord,
  JobRunRecord,
  JobRunStatus,
  JsonValue,
  SecretReference
} from '../../db/types';
import type { JobResult } from '../runtime';

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
  networkMode: 'none' | 'bridge';
  gpuRequested: boolean;
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
  networkMode: 'none' | 'bridge';
  gpuRequested: boolean;
} & BufferedLogs;

export type DockerExecutionResult = {
  jobResult: JobResult;
  telemetry: DockerExecutionTelemetry;
};

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

async function ensureWorkspace(runId: string, workspaceRoot: string): Promise<WorkspacePaths> {
  const root = workspaceRoot;
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

function resolveNetworkMode(
  requested: DockerJobMetadata['docker']['networkMode'] | undefined,
  config: DockerRuntimeConfig
): 'none' | 'bridge' {
  const { network } = config;

  if (network.isolationEnabled) {
    return 'none';
  }

  if (requested) {
    if (!network.allowedModes.has(requested)) {
      throw new Error(`Network mode ${requested} is not permitted by policy`);
    }
    if (!network.allowModeOverride && requested !== network.defaultMode) {
      throw new Error('Network overrides are disabled for docker jobs');
    }
    return requested;
  }

  return network.defaultMode;
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return unitIndex === 0 ? `${Math.round(value)} ${units[unitIndex]}` : `${value.toFixed(2)} ${units[unitIndex]}`;
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
  config: DockerRuntimeConfig;
}): Promise<DockerCommandPlan> {
  const containerName = buildContainerName(options.definition, options.run);
  const args: string[] = ['run', '--rm', '--name', containerName];
  const policyResult = evaluateDockerImagePolicy(options.metadata.image, options.config);
  if (!policyResult.allowed) {
    throw new Error(policyResult.reason ?? 'Docker image is not permitted by policy');
  }
  const workspaceMountPath = options.metadata.workspaceMountPath ?? '/workspace';
  args.push('-v', `${options.paths.mountSource}:${workspaceMountPath}:rw`);
  const networkMode = resolveNetworkMode(options.metadata.networkMode, options.config);
  args.push('--network', networkMode);
  let gpuRequested = false;
  if (options.metadata.requiresGpu) {
    if (!options.config.gpuEnabled) {
      throw new Error('Docker job requested GPU resources but GPU support is disabled');
    }
    args.push('--gpus', 'all');
    gpuRequested = true;
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
      const mode = 'ro';
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
    networkMode,
    gpuRequested,
  });
  return { args, containerName, workspaceMountPath, networkMode, gpuRequested } satisfies DockerCommandPlan;
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
    const runtimeConfig = getDockerRuntimeConfig();
    const workspace = await ensureWorkspace(options.run.id, runtimeConfig.workspaceRoot);
    const resolvePath = (relative: string) => resolveWorkspacePath(workspace.workDir, relative);
    const requiresFilestore = Boolean(
      (options.metadata.inputs && options.metadata.inputs.length > 0) ||
        (options.metadata.outputs && options.metadata.outputs.length > 0)
    );
    let filestoreClient: Awaited<ReturnType<typeof getFilestoreClient>> | null = null;
    const filestoreSummary: {
      inputs: StageFilestoreInputsResult['inputs'];
      outputs: CollectFilestoreOutputsResult['outputs'];
      bytesDownloaded: number;
      filesDownloaded: number;
      bytesUploaded: number;
      filesUploaded: number;
    } = {
      inputs: [],
      outputs: [],
      bytesDownloaded: 0,
      filesDownloaded: 0,
      bytesUploaded: 0,
      filesUploaded: 0
    };

    if (requiresFilestore) {
      filestoreClient = await getFilestoreClient();
      options.logger('Resolved filestore client configuration for docker job', {
        baseUrl: filestoreClient.config.baseUrl,
        source: filestoreClient.config.source
      });
    }

    const timeoutMs = options.timeoutMs ?? null;
    let telemetry: DockerExecutionTelemetry | null = null;
    let containerName: string | null = null;
    try {
      if (filestoreClient && options.metadata.inputs && options.metadata.inputs.length > 0) {
        const staged = await stageFilestoreInputs({
          client: filestoreClient.client,
          inputs: options.metadata.inputs,
          resolveWorkspacePath: resolvePath,
          workDir: workspace.workDir,
          definition: options.definition,
          run: options.run,
          logger: options.logger
        });
        filestoreSummary.inputs = staged.inputs;
        filestoreSummary.bytesDownloaded = staged.bytesDownloaded;
        filestoreSummary.filesDownloaded = staged.filesDownloaded;
      }

      if (
        runtimeConfig.maxWorkspaceBytes !== null &&
        filestoreSummary.bytesDownloaded > runtimeConfig.maxWorkspaceBytes
      ) {
        throw new Error(
          `Workspace inputs total ${formatBytes(filestoreSummary.bytesDownloaded)}, exceeding limit ${formatBytes(runtimeConfig.maxWorkspaceBytes)}`
        );
      }

      const commandPlan = await buildDockerCommand({
        metadata: options.metadata,
        paths: workspace,
        definition: options.definition,
        run: options.run,
        parameters: options.parameters,
        resolveSecret: options.resolveSecret,
        logger: options.logger,
        config: runtimeConfig,
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
        networkMode: commandPlan.networkMode,
        gpuRequested: commandPlan.gpuRequested,
        ...execution.logs,
      } satisfies DockerExecutionTelemetry;

      if (filestoreClient && options.metadata.outputs && options.metadata.outputs.length > 0) {
        const collected = await collectFilestoreOutputs({
          client: filestoreClient.client,
          outputs: options.metadata.outputs,
          resolveWorkspacePath: resolvePath,
          definition: options.definition,
          run: options.run,
          logger: options.logger
        });
        filestoreSummary.outputs = collected.outputs;
        filestoreSummary.bytesUploaded = collected.bytesUploaded;
        filestoreSummary.filesUploaded = collected.filesUploaded;
      }

      const metrics: JsonValue = {
        docker: {
          containerName: commandPlan.containerName,
          image: options.metadata.image,
          exitCode: execution.exitCode,
          signal: execution.signal ?? null,
          durationMs: Math.round(execution.durationMs),
          timedOut: execution.timedOut,
          networkMode: commandPlan.networkMode,
          gpuRequested: commandPlan.gpuRequested,
        },
        filestore: filestoreClient
          ? {
              bytesDownloaded: filestoreSummary.bytesDownloaded,
              filesDownloaded: filestoreSummary.filesDownloaded,
              bytesUploaded: filestoreSummary.bytesUploaded,
              filesUploaded: filestoreSummary.filesUploaded,
            }
          : null,
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
          networkMode: commandPlan.networkMode,
          gpuRequested: commandPlan.gpuRequested,
        },
        filestore: filestoreClient
          ? {
              baseUrl: filestoreClient.config.baseUrl,
              source: filestoreClient.config.source,
              bytesDownloaded: filestoreSummary.bytesDownloaded,
              filesDownloaded: filestoreSummary.filesDownloaded,
              bytesUploaded: filestoreSummary.bytesUploaded,
              filesUploaded: filestoreSummary.filesUploaded,
              inputs: filestoreSummary.inputs,
              outputs: filestoreSummary.outputs,
            }
          : null,
      } satisfies JsonValue;

      const filestoreResult = filestoreClient
        ? {
            inputs: filestoreSummary.inputs.map((entry) => ({
              id: entry.id,
              backendMountId: entry.backendMountId,
              nodeId: entry.nodeId,
              path: entry.path,
              workspacePath: entry.workspacePath,
              bytesDownloaded: entry.bytesDownloaded,
              filesDownloaded: entry.filesDownloaded,
            })),
            outputs: filestoreSummary.outputs.map((entry) => ({
              id: entry.id,
              backendMountId: entry.backendMountId,
              nodeId: entry.nodeId,
              path: entry.resolvedPath,
              workspacePath: entry.workspacePath,
              bytesUploaded: entry.bytesUploaded,
              fileCount: entry.fileCount,
            })),
          }
        : null;

      const resultPayload: JsonValue = {
        exitCode: execution.exitCode,
        signal: execution.signal ?? null,
        containerName: commandPlan.containerName,
        image: options.metadata.image,
        timedOut: execution.timedOut,
        networkMode: commandPlan.networkMode,
        gpuRequested: commandPlan.gpuRequested,
        filestore: filestoreResult,
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
