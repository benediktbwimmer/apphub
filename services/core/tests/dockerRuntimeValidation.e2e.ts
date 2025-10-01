import './setupTestEnv';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runE2E } from '@apphub/test-helpers';
import type {
  CommandResponse,
  CreateDirectoryInput,
  DownloadFileResult,
  FilestoreNodeResponse,
  ListNodesInput,
  ListNodesResult,
  UploadFileInput,
  FilestoreClient
} from '@apphub/filestore-client';

import type { FilestoreRuntimeConfig } from '../src/config/filestore';
import { DockerJobRunner } from '../src/jobs/docker/runner';
import type {
  DockerJobMetadata,
  JobDefinitionRecord,
  JobRunRecord,
  JsonValue
} from '../src/db/types';

type StubNodeKind = 'file' | 'directory';

type StubNode = {
  id: number;
  backendMountId: number;
  path: string;
  name: string;
  depth: number;
  kind: StubNodeKind;
  sizeBytes: number;
  checksum: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  parentId: number | null;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  lastModifiedAt: string | null;
  dataPath: string | null;
};

const POSIX = path.posix;

class FakeFilestoreClient
  implements Pick<
    FilestoreClient,
    'getNodeByPath' | 'getNodeById' | 'downloadFile' | 'listNodes' | 'uploadFile' | 'createDirectory'
  >
{
  private readonly nodes = new Map<number, StubNode>();
  private readonly pathIndex = new Map<string, number>();
  private readonly uploads: StubNode[] = [];
  private nextId = 1;

  constructor(private readonly root: string) {}

  async registerFile(options: { backendMountId: number; path: string; filePath: string }): Promise<void> {
    const normalized = this.normalizePath(options.path);
    const stats = await stat(options.filePath);
    const buffer = await readFile(options.filePath);
    const checksum = this.buildChecksum(buffer);
    const now = new Date().toISOString();
    const parentId = this.ensureParentDirectories(options.backendMountId, normalized);
    const node: StubNode = {
      id: this.nextId++,
      backendMountId: options.backendMountId,
      path: normalized,
      name: this.basename(normalized),
      depth: this.depth(normalized),
      kind: 'file',
      sizeBytes: stats.size,
      checksum,
      contentHash: null,
      metadata: {},
      parentId,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      lastModifiedAt: now,
      dataPath: options.filePath
    } satisfies StubNode;
    this.nodes.set(node.id, node);
    this.pathIndex.set(this.buildKey(options.backendMountId, normalized), node.id);
  }

  get uploadedNodes(): StubNode[] {
    return this.uploads;
  }

  async getNodeByPath(input: { backendMountId: number; path: string }): Promise<FilestoreNodeResponse | null> {
    const normalized = this.normalizePath(input.path);
    const key = this.buildKey(input.backendMountId, normalized);
    const nodeId = this.pathIndex.get(key);
    if (!nodeId) {
      return null;
    }
    const node = this.nodes.get(nodeId)!;
    return this.toResponse(node);
  }

  async getNodeById(id: number): Promise<FilestoreNodeResponse | null> {
    const node = this.nodes.get(id);
    return node ? this.toResponse(node) : null;
  }

  async downloadFile(id: number): Promise<DownloadFileResult> {
    const node = this.nodes.get(id);
    if (!node || node.kind !== 'file' || !node.dataPath) {
      throw new Error(`File ${id} not found in fake filestore`);
    }
    const stats = await stat(node.dataPath);
    return {
      stream: createReadStream(node.dataPath),
      status: 200,
      contentLength: stats.size,
      totalSize: stats.size,
      checksum: node.checksum,
      contentHash: node.contentHash,
      contentType: 'application/octet-stream',
      lastModified: node.lastModifiedAt,
      headers: {}
    } satisfies DownloadFileResult;
  }

  async listNodes(input: ListNodesInput): Promise<ListNodesResult> {
    const normalized = this.normalizePath(input.path ?? '');
    const targetParentKey = normalized ? this.buildKey(input.backendMountId, normalized) : null;
    const parentId = targetParentKey ? this.pathIndex.get(targetParentKey) ?? null : null;
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 100;
    const candidates = [...this.nodes.values()]
      .filter((node) => node.backendMountId === input.backendMountId && node.parentId === parentId)
      .sort((a, b) => a.path.localeCompare(b.path));
    const slice = candidates.slice(offset, offset + limit);
    const nextOffset = offset + slice.length < candidates.length ? offset + slice.length : null;
    return {
      nodes: slice.map((node) => this.toResponse(node)),
      total: candidates.length,
      nextOffset,
      limit,
      offset
    } satisfies ListNodesResult;
  }

  async uploadFile<T = Record<string, unknown>>(input: UploadFileInput): Promise<CommandResponse<T>> {
    const normalized = this.normalizePath(input.path);
    const parentId = this.ensureParentDirectories(input.backendMountId, normalized);
    const filePath = path.join(this.root, normalized);
    await mkdir(path.dirname(filePath), { recursive: true });
    const buffer = await this.resolveContentBuffer(input.content);
    await writeFile(filePath, buffer);
    const checksum = this.buildChecksum(buffer);
    const now = new Date().toISOString();
    const key = this.buildKey(input.backendMountId, normalized);
    let nodeId = this.pathIndex.get(key);
    let node: StubNode;
    if (nodeId) {
      node = this.nodes.get(nodeId)!;
      node.sizeBytes = buffer.length;
      node.checksum = checksum;
      node.updatedAt = now;
      node.lastSeenAt = now;
      node.lastModifiedAt = now;
      node.dataPath = filePath;
    } else {
      node = {
        id: this.nextId++,
        backendMountId: input.backendMountId,
        path: normalized,
        name: this.basename(normalized),
        depth: this.depth(normalized),
        kind: 'file',
        sizeBytes: buffer.length,
        checksum,
        contentHash: null,
        metadata: {},
        parentId,
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        lastModifiedAt: now,
        dataPath: filePath
      } satisfies StubNode;
      nodeId = node.id;
      this.nodes.set(nodeId, node);
      this.pathIndex.set(key, nodeId);
    }
    this.uploads.push(node);
    return {
      idempotent: false,
      journalEntryId: node.id,
      node: this.toResponse(node),
      result: { uploaded: true } as unknown as T
    } satisfies CommandResponse<T>;
  }

  async createDirectory<T = Record<string, unknown>>(input: CreateDirectoryInput): Promise<CommandResponse<T>> {
    const normalized = this.normalizePath(input.path);
    if (!normalized) {
      return {
        idempotent: true,
        journalEntryId: 0,
        node: null,
        result: { created: false } as unknown as T
      } satisfies CommandResponse<T>;
    }
    const nodeId = this.ensureDirectoryNode(input.backendMountId, normalized);
    const node = this.nodes.get(nodeId)!;
    return {
      idempotent: false,
      journalEntryId: node.id,
      node: this.toResponse(node),
      result: { created: true } as unknown as T
    } satisfies CommandResponse<T>;
  }

  async readFileContents(backendMountId: number, remotePath: string): Promise<string> {
    const normalized = this.normalizePath(remotePath);
    const absolute = path.join(this.root, normalized);
    const data = await readFile(absolute, 'utf8');
    const key = this.buildKey(backendMountId, normalized);
    const nodeId = this.pathIndex.get(key);
    if (nodeId) {
      const now = new Date().toISOString();
      const node = this.nodes.get(nodeId)!;
      node.lastSeenAt = now;
    }
    return data;
  }

  private resolveContentBuffer(content: UploadFileInput['content']): Promise<Buffer> {
    if (typeof content === 'string') {
      return Promise.resolve(Buffer.from(content));
    }
    if (content instanceof Uint8Array) {
      return Promise.resolve(Buffer.from(content));
    }
    if (content && typeof (content as NodeJS.ReadableStream).pipe === 'function') {
      return this.consumeStream(content as NodeJS.ReadableStream);
    }
    return Promise.resolve(Buffer.alloc(0));
  }

  private async consumeStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private ensureParentDirectories(backendMountId: number, normalizedPath: string): number | null {
    if (!normalizedPath) {
      return null;
    }
    const segments = this.split(normalizedPath);
    if (segments.length <= 1) {
      return null;
    }
    return this.ensureDirectoryChain(backendMountId, segments.slice(0, segments.length - 1));
  }

  private ensureDirectoryNode(backendMountId: number, normalizedPath: string): number {
    const existing = this.pathIndex.get(this.buildKey(backendMountId, normalizedPath));
    if (existing) {
      return existing;
    }
    const parentId = this.ensureParentDirectories(backendMountId, normalizedPath);
    const segments = this.split(normalizedPath);
    const nodeId = this.ensureDirectoryChain(backendMountId, segments);
    if (nodeId === null) {
      throw new Error(`Failed to create directory ${normalizedPath}`);
    }
    const node = this.nodes.get(nodeId)!;
    node.parentId = parentId;
    return nodeId;
  }

  private ensureDirectoryChain(backendMountId: number, segments: string[]): number | null {
    if (segments.length === 0) {
      return null;
    }
    let parentId: number | null = null;
    let currentPath = '';
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const key = this.buildKey(backendMountId, currentPath);
      let nodeId = this.pathIndex.get(key);
      if (!nodeId) {
        const now = new Date().toISOString();
        const node: StubNode = {
          id: this.nextId++,
          backendMountId,
          path: currentPath,
          name: segment,
          depth: this.depth(currentPath),
          kind: 'directory',
          sizeBytes: 0,
          checksum: null,
          contentHash: null,
          metadata: {},
          parentId,
          createdAt: now,
          updatedAt: now,
          lastSeenAt: now,
          lastModifiedAt: now,
          dataPath: null
        } satisfies StubNode;
        nodeId = node.id;
        this.nodes.set(nodeId, node);
        this.pathIndex.set(key, nodeId);
      }
      parentId = nodeId;
    }
    return parentId;
  }

  private buildKey(backendMountId: number, normalizedPath: string): string {
    return `${backendMountId}:${normalizedPath}`;
  }

  private normalizePath(value: string): string {
    const normalized = POSIX.normalize(value ?? '');
    const trimmed = normalized.replace(/^\/+/, '').replace(/\/+$/, '');
    return trimmed;
  }

  private split(value: string): string[] {
    if (!value) {
      return [];
    }
    return value.split('/').filter(Boolean);
  }

  private basename(value: string): string {
    if (!value) {
      return '';
    }
    const segments = this.split(value);
    return segments[segments.length - 1] ?? '';
  }

  private depth(value: string): number {
    if (!value) {
      return 0;
    }
    return this.split(value).length;
  }

  private buildChecksum(buffer: Buffer): string {
    return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
  }

  private toResponse(node: StubNode): FilestoreNodeResponse {
    return {
      id: node.id,
      backendMountId: node.backendMountId,
      parentId: node.parentId,
      path: node.path,
      name: node.name,
      depth: node.depth,
      kind: node.kind,
      sizeBytes: node.sizeBytes,
      checksum: node.checksum,
      contentHash: node.contentHash,
      metadata: node.metadata,
      state: 'active',
      version: 1,
      isSymlink: false,
      lastSeenAt: node.lastSeenAt,
      lastModifiedAt: node.lastModifiedAt,
      consistencyState: 'consistent',
      consistencyCheckedAt: node.lastSeenAt,
      lastReconciledAt: node.lastSeenAt,
      lastDriftDetectedAt: null,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
      deletedAt: null,
      rollup: null
    } satisfies FilestoreNodeResponse;
  }
}

function buildDefinition(metadata: JsonValue): JobDefinitionRecord {
  const timestamp = new Date('2024-05-01T00:00:00.000Z').toISOString();
  return {
    id: 'docker-job-def',
    slug: 'docker-validation-job',
    name: 'Docker Validation Job',
    version: 1,
    type: 'batch',
    runtime: 'docker',
    entryPoint: '',
    parametersSchema: {},
    defaultParameters: {},
    outputSchema: {},
    timeoutMs: 120000,
    retryPolicy: null,
    metadata,
    createdAt: timestamp,
    updatedAt: timestamp
  } satisfies JobDefinitionRecord;
}

function buildRun(): JobRunRecord {
  const timestamp = new Date('2024-05-01T00:00:00.000Z').toISOString();
  return {
    id: 'run-1',
    jobDefinitionId: 'docker-job-def',
    status: 'running',
    parameters: { trigger: 'integration-test' },
    result: null,
    errorMessage: null,
    logsUrl: null,
    metrics: null,
    context: null,
    timeoutMs: 15000,
    attempt: 1,
    maxAttempts: null,
    durationMs: null,
    scheduledAt: timestamp,
    startedAt: timestamp,
    completedAt: null,
    lastHeartbeatAt: null,
    retryCount: 0,
    failureReason: null,
    createdAt: timestamp,
    updatedAt: timestamp
  } satisfies JobRunRecord;
}

function buildDockerScript(): string {
  return `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseWorkspace(args) {
  let mount = null;
  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];
    if (current === '-v' || current === '--volume') {
      index += 1;
      const spec = args[index];
      if (!spec) {
        continue;
      }
      const parts = spec.split(':');
      const host = parts[0];
      const container = parts[1];
      if (!mount && container === '/workspace') {
        mount = host;
      }
      continue;
    }
    if (
      current === '--name' ||
      current === '--network' ||
      current === '--entrypoint' ||
      current === '--gpus' ||
      current === '-e' ||
      current === '-p'
    ) {
      index += 1;
      continue;
    }
    if (current && current.startsWith('--')) {
      continue;
    }
    // first positional argument after flags is the image; break once reached
    break;
  }
  return mount;
}

async function main() {
  const [, , command, ...rest] = process.argv;
  if (!command) {
    process.exit(1);
  }
  if (['rm', 'stop', 'kill', 'inspect', 'port'].includes(command)) {
    process.exit(0);
  }
  if (command !== 'run') {
    process.exit(0);
  }
  const workspace = parseWorkspace(rest);
  if (!workspace) {
    console.error('workspace mount missing');
    process.exit(1);
  }
  const inputPath = path.join(workspace, 'inputs', 'report.json');
  const outputPath = path.join(workspace, 'outputs', 'summary.json');
  const raw = fs.readFileSync(inputPath, 'utf8');
  const payload = JSON.parse(raw);
  const summary = {
    recordCount: Array.isArray(payload.records) ? payload.records.length : 0,
    message: payload.message,
    generatedAt: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log('docker-mock: processed input records');
  console.error('docker-mock: summary written');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;
}

runE2E(async ({ registerCleanup }) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'docker-runtime-e2e-'));
  registerCleanup(() => rm(tempRoot, { recursive: true, force: true }));

  const workspaceRoot = path.join(tempRoot, 'workspace-root');
  await mkdir(workspaceRoot, { recursive: true });
  const previousWorkspaceRoot = process.env.CORE_DOCKER_WORKSPACE_ROOT;
  process.env.CORE_DOCKER_WORKSPACE_ROOT = workspaceRoot;
  registerCleanup(() => {
    if (previousWorkspaceRoot === undefined) {
      delete process.env.CORE_DOCKER_WORKSPACE_ROOT;
    } else {
      process.env.CORE_DOCKER_WORKSPACE_ROOT = previousWorkspaceRoot;
    }
  });

  const dockerBinDir = path.join(tempRoot, 'bin');
  await mkdir(dockerBinDir, { recursive: true });
  const dockerScriptPath = path.join(dockerBinDir, 'docker');
  await writeFile(dockerScriptPath, buildDockerScript(), { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${dockerBinDir}:${previousPath ?? ''}`;
  registerCleanup(() => {
    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }
  });

  const filestoreRoot = path.join(tempRoot, 'filestore');
  await mkdir(filestoreRoot, { recursive: true });
  const filestore = new FakeFilestoreClient(filestoreRoot);

  const inputPayload = {
    message: 'synthetic workload',
    records: [{ id: 1 }, { id: 2 }, { id: 3 }]
  } satisfies Record<string, unknown>;
  const inputRelative = 'incoming/report.json';
  const inputAbsolute = path.join(filestoreRoot, inputRelative);
  await mkdir(path.dirname(inputAbsolute), { recursive: true });
  await writeFile(inputAbsolute, JSON.stringify(inputPayload, null, 2), 'utf8');
  await filestore.registerFile({ backendMountId: 1, path: inputRelative, filePath: inputAbsolute });

  const filestoreConfig: FilestoreRuntimeConfig = {
    baseUrl: 'http://127.0.0.1:0/filestore-mock',
    token: null,
    userAgent: 'docker-runtime-validation-test',
    fetchTimeoutMs: null,
    source: 'env'
  } satisfies FilestoreRuntimeConfig;

  const runner = new DockerJobRunner({
    getFilestoreClient: async () => ({
      client: filestore as unknown as FilestoreClient,
      config: filestoreConfig
    })
  });

  const definition = buildDefinition({ docker: {} } satisfies JsonValue);
  const run = buildRun();

  const metadata: DockerJobMetadata['docker'] = {
    image: 'local/docker-mock:latest',
    workspaceMountPath: '/workspace',
    command: ['node', '/workspace/scripts/process-job.mjs'],
    args: ['--input', '/workspace/inputs/report.json', '--output', '/workspace/outputs/summary.json'],
    environment: [
      { name: 'MODE', value: 'validation' },
      { name: 'TRACE_ID', value: 'docker-runtime-e2e' }
    ],
    inputs: [
      {
        id: 'report',
        workspacePath: 'inputs/report.json',
        source: {
          type: 'filestorePath',
          backendMountId: 1,
          path: inputRelative
        }
      }
    ],
    outputs: [
      {
        id: 'summary',
        workspacePath: 'outputs/summary.json',
        upload: {
          backendMountId: 1,
          pathTemplate: '/datasets/processed/${runId}/summary.json',
          contentType: 'application/json',
          overwrite: true
        }
      }
    ]
  } satisfies DockerJobMetadata['docker'];

  const logs: Array<{ message: string; meta: Record<string, unknown> | undefined }> = [];
  const logger = (message: string, meta?: Record<string, unknown>) => {
    logs.push({ message, meta });
  };

  const updateRequests: JsonValue[] = [];
  const update = async (updates: { metrics?: JsonValue | null; context?: JsonValue | null }) => {
    updateRequests.push(updates);
    return {
      ...run,
      metrics: (updates.metrics ?? run.metrics) as JsonValue,
      context: (updates.context ?? run.context) as JsonValue
    } satisfies JobRunRecord;
  };

  const result = await runner.execute({
    definition,
    run,
    metadata,
    parameters: run.parameters,
    timeoutMs: 10000,
    logger,
    update,
    resolveSecret: () => null
  });

  assert.equal(result.jobResult.status, 'succeeded');
  assert.equal(result.telemetry.exitCode, 0);
  assert.ok(result.telemetry.stdout.includes('processed input records'));
  assert.ok(result.telemetry.stderr.includes('summary written'));
  assert.deepEqual(result.telemetry.command, [
    ...(metadata.command ?? []),
    ...(metadata.args ?? [])
  ]);

  const metrics = result.jobResult.metrics as Record<string, any> | null;
  assert(metrics && metrics.docker, 'docker metrics missing');
  assert(metrics?.filestore?.bytesDownloaded > 0, 'expected filestore downloads recorded');
  assert(metrics?.filestore?.bytesUploaded > 0, 'expected filestore uploads recorded');

  const context = result.jobResult.context as Record<string, any> | null;
  assert(context && context.filestore, 'filestore context missing');
  assert.equal(context?.filestore?.inputs?.length, 1);
  assert.equal(context?.filestore?.outputs?.length, 1);

  const payload = result.jobResult.result as Record<string, any> | null;
  assert(payload && payload.filestore, 'result payload missing filestore summary');
  const outputDescriptor = Array.isArray(payload!.filestore!.outputs)
    ? payload!.filestore!.outputs[0]
    : undefined;
  assert(outputDescriptor, 'expected filestore output metadata');
  assert.equal(outputDescriptor!.path, '/datasets/processed/run-1/summary.json');

  const uploadedContents = await filestore.readFileContents(1, 'datasets/processed/run-1/summary.json');
  const parsed = JSON.parse(uploadedContents) as Record<string, unknown>;
  assert.equal(parsed.recordCount, 3);
  assert.equal(parsed.message, inputPayload.message);

  assert(logs.some((entry) => entry.message.includes('Docker stdout')));
  assert(logs.some((entry) => entry.message.includes('Docker stderr')));
  assert(updateRequests.length >= 1, 'expected at least one job run update');

  assert.equal(filestore.uploadedNodes.length, 1);
});
