import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('../src/jobs/docker/filestoreClient', () => ({
  getFilestoreClient: vi.fn()
}));

vi.mock('../src/jobs/docker/filestoreArtifacts', () => ({
  stageFilestoreInputs: vi.fn(),
  collectFilestoreOutputs: vi.fn()
}));

import { DockerJobRunner } from '../src/jobs/docker/runner';
import type { DockerExecutionResult } from '../src/jobs/docker/runner';
import { getFilestoreClient } from '../src/jobs/docker/filestoreClient';
import {
  stageFilestoreInputs,
  collectFilestoreOutputs,
  type StageFilestoreInputsResult,
  type CollectFilestoreOutputsResult
} from '../src/jobs/docker/filestoreArtifacts';
import type {
  DockerJobMetadata,
  JobDefinitionRecord,
  JobRunRecord,
  JsonValue,
  SecretReference
} from '../src/db/types';

const baseDate = new Date('2024-01-01T00:00:00.000Z');

const getFilestoreClientMock = getFilestoreClient as unknown as vi.Mock;
const stageFilestoreInputsMock = stageFilestoreInputs as unknown as vi.Mock;
const collectFilestoreOutputsMock = collectFilestoreOutputs as unknown as vi.Mock;

function buildDefinition(metadata: JsonValue): JobDefinitionRecord {
  return {
    id: 'job-def-1',
    slug: 'docker-example',
    name: 'Docker Example',
    version: 1,
    type: 'batch',
    runtime: 'docker',
    entryPoint: '',
    parametersSchema: {},
    defaultParameters: {},
    outputSchema: {},
    timeoutMs: null,
    retryPolicy: null,
    metadata,
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
  } satisfies JobDefinitionRecord;
}

function buildRun(status: JobRunRecord['status']): JobRunRecord {
  return {
    id: 'run-1',
    jobDefinitionId: 'job-def-1',
    status,
    parameters: { message: 'hello' },
    result: null,
    errorMessage: null,
    logsUrl: null,
    metrics: null,
    context: null,
    timeoutMs: null,
    attempt: 1,
    maxAttempts: null,
    durationMs: null,
    scheduledAt: baseDate.toISOString(),
    startedAt: baseDate.toISOString(),
    completedAt: null,
    lastHeartbeatAt: null,
    retryCount: 0,
    failureReason: null,
    createdAt: baseDate.toISOString(),
    updatedAt: baseDate.toISOString(),
  } satisfies JobRunRecord;
}

function resolveSecret(secret: SecretReference): string | null {
  return `${secret.source}:${secret.key}`;
}

describe('DockerJobRunner', () => {
  const run = buildRun('running');
  const metadata: DockerJobMetadata['docker'] = {
    image: 'example/app:latest',
    command: ['--config', '/workspace/config.json'],
    configFile: {
      filename: 'config/config.json',
      mountPath: '/workspace/config.json',
      format: 'json',
    },
    environment: [
      {
        name: 'STATIC_VALUE',
        value: 'one',
      },
      {
        name: 'SECRET_VALUE',
        secret: { source: 'env', key: 'SECRET_TOKEN' },
      },
    ],
  } satisfies DockerJobMetadata['docker'];

  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'docker-runner-test-'));
    process.env.CATALOG_DOCKER_WORKSPACE_ROOT = workspaceRoot;
    getFilestoreClientMock.mockReset();
    stageFilestoreInputsMock.mockReset();
    collectFilestoreOutputsMock.mockReset();
  });

  afterEach(async () => {
    delete process.env.CATALOG_DOCKER_WORKSPACE_ROOT;
    vi.clearAllMocks();
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  test('executes docker run and captures logs', async () => {
    const spawnMock = vi.fn(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child: any = new PassThrough();
      child.stdout = stdout;
      child.stderr = stderr;
      child.killed = false;
      child.kill = vi.fn(() => {
        child.killed = true;
        return true;
      });
      queueMicrotask(() => {
        stdout.write('hello stdout\n');
        stderr.write('warning stderr\n');
        stdout.end();
        stderr.end();
        child.emit('close', 0, null);
      });
      return child;
    });

    const runDockerCommandMock = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));

    const runner = new DockerJobRunner({
      spawn: spawnMock as unknown as typeof spawn,
      runDockerCommand: runDockerCommandMock,
    });

    const definition = buildDefinition({ docker: metadata } satisfies JsonValue);

    const result = (await runner.execute({
      definition,
      run,
      metadata,
      parameters: run.parameters,
      timeoutMs: null,
      logger: vi.fn(),
      update: vi.fn(async () => run),
      resolveSecret,
    })) as DockerExecutionResult;

    expect(result.jobResult.status).toBe('succeeded');
    expect(result.telemetry.exitCode).toBe(0);
    expect(result.telemetry.stdout).toContain('hello stdout');
    expect(result.telemetry.stderr).toContain('warning stderr');

    const spawnArgs = spawnMock.mock.calls[0][1] as string[];
    expect(spawnArgs).toContain('run');
    expect(spawnArgs).toContain('--rm');
    expect(spawnArgs).toContain(metadata.image);

    const entries = await readdir(workspaceRoot);
    expect(entries.length).toBe(0);

    const cleanupCalls = runDockerCommandMock.mock.calls.filter((call) => call[0][0] === 'rm');
    expect(cleanupCalls.length).toBe(1);
  });

  test('terminates container on timeout', async () => {
    let closeChild: (() => void) | null = null;
    const spawnMock = vi.fn(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child: any = new PassThrough();
      child.stdout = stdout;
      child.stderr = stderr;
      child.killed = false;
      child.kill = vi.fn(() => {
        child.killed = true;
        return true;
      });
      closeChild = () => {
        stdout.end();
        stderr.end();
        child.emit('close', 137, 'SIGKILL');
      };
      return child;
    });

    const runDockerCommandMock = vi.fn(async (args: string[]) => {
      if (args[0] === 'kill') {
        closeChild?.();
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });

    const runner = new DockerJobRunner({
      spawn: spawnMock as unknown as typeof spawn,
      runDockerCommand: runDockerCommandMock,
    });

    const definition = buildDefinition({ docker: metadata } satisfies JsonValue);

    const result = (await runner.execute({
      definition,
      run,
      metadata,
      parameters: run.parameters,
      timeoutMs: 10,
      logger: vi.fn(),
      update: vi.fn(async () => run),
      resolveSecret,
    })) as DockerExecutionResult;

    expect(result.jobResult.status).toBe('expired');
    const killCalls = runDockerCommandMock.mock.calls.filter((call) => call[0][0] === 'kill');
    expect(killCalls.length).toBeGreaterThan(0);
  });

  test('stages filestore inputs and collects outputs', async () => {
    const stageResult: StageFilestoreInputsResult = {
      inputs: [
        {
          id: 'config',
          workspacePath: 'inputs/data.txt',
          source: { type: 'filestoreNode', nodeId: 11 },
          nodeId: 101,
          backendMountId: 5,
          path: '/datasets/data.txt',
          kind: 'file',
          sizeBytes: 128,
          checksum: 'sha256:abc',
          contentHash: 'hash-1',
          bytesDownloaded: 128,
          filesDownloaded: 1,
          checksumVerified: true
        }
      ],
      bytesDownloaded: 128,
      filesDownloaded: 1
    };
    const collectResult: CollectFilestoreOutputsResult = {
      outputs: [
        {
          id: 'report',
          workspacePath: 'outputs/report.txt',
          backendMountId: 7,
          resolvedPath: '/reports/run-1/report.txt',
          declaredPathTemplate: 'reports/${runId}/report.txt',
          nodeId: 707,
          bytesUploaded: 256,
          fileCount: 1,
          checksum: 'sha256:def',
          contentHash: 'hash-2'
        }
      ],
      bytesUploaded: 256,
      filesUploaded: 1
    };

    getFilestoreClientMock.mockResolvedValue({
      client: {} as unknown,
      config: {
        baseUrl: 'http://filestore.local',
        token: null,
        userAgent: 'test-agent',
        fetchTimeoutMs: null,
        source: 'env'
      }
    });
    stageFilestoreInputsMock.mockResolvedValue(stageResult);
    collectFilestoreOutputsMock.mockResolvedValue(collectResult);

    const spawnMock = vi.fn(() => {
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const child: any = new PassThrough();
      child.stdout = stdout;
      child.stderr = stderr;
      child.killed = false;
      child.kill = vi.fn(() => {
        child.killed = true;
        return true;
      });
      queueMicrotask(() => {
        stdout.end();
        stderr.end();
        child.emit('close', 0, null);
      });
      return child;
    });

    const runDockerCommandMock = vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' }));

    const runner = new DockerJobRunner({
      spawn: spawnMock as unknown as typeof spawn,
      runDockerCommand: runDockerCommandMock,
    });

    const definition = buildDefinition({
      docker: {
        ...metadata,
        inputs: [
          {
            id: 'config',
            source: { type: 'filestoreNode', nodeId: 11 },
            workspacePath: 'inputs/data.txt'
          }
        ],
        outputs: [
          {
            id: 'report',
            workspacePath: 'outputs/report.txt',
            upload: {
              backendMountId: 7,
              pathTemplate: 'reports/${runId}/report.txt'
            }
          }
        ]
      }
    } satisfies JsonValue);

    const result = (await runner.execute({
      definition,
      run,
      metadata: definition.metadata?.docker as DockerJobMetadata['docker'],
      parameters: run.parameters,
      timeoutMs: null,
      logger: vi.fn(),
      update: vi.fn(async () => run),
      resolveSecret,
    })) as DockerExecutionResult;

    expect(getFilestoreClientMock).toHaveBeenCalledTimes(1);
    expect(stageFilestoreInputsMock).toHaveBeenCalledTimes(1);
    expect(collectFilestoreOutputsMock).toHaveBeenCalledTimes(1);

    const context = result.jobResult.context as Record<string, unknown>;
    expect(context?.filestore).toEqual({
      baseUrl: 'http://filestore.local',
      source: 'env',
      bytesDownloaded: stageResult.bytesDownloaded,
      filesDownloaded: stageResult.filesDownloaded,
      bytesUploaded: collectResult.bytesUploaded,
      filesUploaded: collectResult.filesUploaded,
      inputs: stageResult.inputs,
      outputs: collectResult.outputs
    });

    const resultPayload = result.jobResult.result as Record<string, unknown>;
    expect(resultPayload.filestore).toEqual({
      inputs: stageResult.inputs.map((entry) => ({
        id: entry.id,
        backendMountId: entry.backendMountId,
        nodeId: entry.nodeId,
        path: entry.path,
        workspacePath: entry.workspacePath,
        bytesDownloaded: entry.bytesDownloaded,
        filesDownloaded: entry.filesDownloaded,
      })),
      outputs: collectResult.outputs.map((entry) => ({
        id: entry.id,
        backendMountId: entry.backendMountId,
        nodeId: entry.nodeId,
        path: entry.resolvedPath,
        workspacePath: entry.workspacePath,
        bytesUploaded: entry.bytesUploaded,
        fileCount: entry.fileCount,
      })),
    });
  });
});
