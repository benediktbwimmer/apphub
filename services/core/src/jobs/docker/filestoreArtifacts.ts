import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import type {
  DockerJobInputDescriptor,
  DockerJobOutputDescriptor,
  JobDefinitionRecord,
  JobRunRecord
} from '../../db/types';
import type {
  FilestoreClient,
  DownloadFileResult,
  FilestoreNodeResponse
} from '@apphub/filestore-client';

const POSIX = path.posix;

const DEFAULT_MAX_FILE_BYTES = 512 * 1024 * 1024; // 512 MiB
const DEFAULT_MAX_TRANSFER_BYTES = 5 * 1024 * 1024 * 1024; // 5 GiB

function parseLimit(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

const MAX_DOWNLOAD_BYTES = parseLimit('CORE_DOCKER_FILESTORE_MAX_DOWNLOAD_BYTES', DEFAULT_MAX_TRANSFER_BYTES);
const MAX_UPLOAD_BYTES = parseLimit('CORE_DOCKER_FILESTORE_MAX_UPLOAD_BYTES', DEFAULT_MAX_TRANSFER_BYTES);
const MAX_FILE_BYTES = parseLimit('CORE_DOCKER_FILESTORE_MAX_FILE_BYTES', DEFAULT_MAX_FILE_BYTES);

function isReadableFile(stats: { isFile(): boolean }): boolean {
  return typeof stats.isFile === 'function' && stats.isFile();
}

function isDirectory(stats: { isDirectory(): boolean }): boolean {
  return typeof stats.isDirectory === 'function' && stats.isDirectory();
}

function normalizeChecksum(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const [algorithm, checksum] = trimmed.includes(':') ? trimmed.split(':', 2) : ['sha256', trimmed];
  return `${algorithm.toLowerCase()}:${checksum.toLowerCase()}`;
}

function formatBytes(bytes: number): string {
  const thresholds = [
    { suffix: 'GiB', value: 1024 * 1024 * 1024 },
    { suffix: 'MiB', value: 1024 * 1024 },
    { suffix: 'KiB', value: 1024 }
  ];
  for (const threshold of thresholds) {
    if (bytes >= threshold.value) {
      return `${(bytes / threshold.value).toFixed(2)} ${threshold.suffix}`;
    }
  }
  return `${bytes} B`;
}

function ensurePosixRelativePath(relativePath: string): string {
  const normalized = POSIX.normalize(relativePath).replace(/^\.\/+/g, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    throw new Error(`Resolved path escapes sandbox: ${relativePath}`);
  }
  return normalized;
}

function renderTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, key) => {
    const replacement = context[key];
    return replacement !== undefined ? replacement : '';
  });
}

type StageLogger = (message: string, meta?: Record<string, unknown>) => void;

type ResolveWorkspacePath = (relative: string) => Promise<string>;

export type StagedInputArtifact = {
  id: string | null;
  workspacePath: string;
  source: DockerJobInputDescriptor['source'];
  nodeId: number;
  backendMountId: number;
  path: string;
  kind: string;
  sizeBytes: number | null;
  checksum: string | null;
  contentHash: string | null;
  bytesDownloaded: number;
  filesDownloaded: number;
  checksumVerified: boolean | null;
};

export type StageFilestoreInputsResult = {
  inputs: StagedInputArtifact[];
  bytesDownloaded: number;
  filesDownloaded: number;
};

export type StageFilestoreInputsOptions = {
  client: FilestoreClient;
  inputs: DockerJobInputDescriptor[] | undefined;
  resolveWorkspacePath: ResolveWorkspacePath;
  workDir: string;
  definition: JobDefinitionRecord;
  run: JobRunRecord;
  logger: StageLogger;
};

export type UploadedArtifact = {
  id: string | null;
  workspacePath: string;
  backendMountId: number;
  resolvedPath: string;
  declaredPathTemplate: string;
  nodeId: number | null;
  bytesUploaded: number;
  fileCount: number;
  checksum: string | null;
  contentHash: string | null;
};

export type CollectFilestoreOutputsResult = {
  outputs: UploadedArtifact[];
  bytesUploaded: number;
  filesUploaded: number;
};

export type CollectFilestoreOutputsOptions = {
  client: FilestoreClient;
  outputs: DockerJobOutputDescriptor[] | undefined;
  resolveWorkspacePath: ResolveWorkspacePath;
  definition: JobDefinitionRecord;
  run: JobRunRecord;
  logger: StageLogger;
};

function assertWithinLimit(bytes: number, limit: number, kind: 'download' | 'upload', descriptor: string) {
  if (bytes > limit) {
    throw new Error(
      `Filestore ${kind} limit exceeded for ${descriptor}: ${formatBytes(bytes)} exceeds ${formatBytes(limit)}`
    );
  }
}

async function writeStreamToFile(
  download: DownloadFileResult,
  targetPath: string,
  expectedSize: number | null,
  expectedChecksum: string | null,
  descriptor: string
): Promise<{ bytes: number; checksum: string | null; verified: boolean | null }> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const normalizedChecksum = normalizeChecksum(expectedChecksum);
  const algorithm = normalizedChecksum ? normalizedChecksum.split(':', 2)[0] : null;
  const hash = algorithm ? createHash(algorithm) : null;
  let bytes = 0;
  const writeStream = createWriteStream(targetPath, { mode: 0o600 });

  await pipeline(download.stream, async function* (source) {
    for await (const chunk of source) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (hash) {
        hash.update(buffer);
      }
      if (bytes > MAX_FILE_BYTES) {
        throw new Error(
          `File exceeds maximum transfer size (${formatBytes(bytes)} > ${formatBytes(MAX_FILE_BYTES)})`
        );
      }
      yield buffer;
    }
  }, writeStream);

  if (expectedSize !== null && expectedSize !== undefined && bytes !== expectedSize) {
    throw new Error(
      `Downloaded byte size mismatch for ${descriptor}: expected ${expectedSize}, received ${bytes}`
    );
  }

  const computedChecksum = hash ? `${algorithm}:${hash.digest('hex')}` : download.checksum;
  const normalizedComputed = normalizeChecksum(computedChecksum);
  if (normalizedChecksum && normalizedComputed && normalizedChecksum !== normalizedComputed) {
    throw new Error(`Checksum mismatch for ${descriptor}`);
  }

  return {
    bytes,
    checksum: normalizedComputed,
    verified: normalizedChecksum ? normalizedChecksum === normalizedComputed : null
  };
}

async function gatherInputNode(
  client: FilestoreClient,
  descriptor: DockerJobInputDescriptor
): Promise<FilestoreNodeResponse | null> {
  if (descriptor.source.type === 'filestoreNode') {
    const nodeIdRaw = descriptor.source.nodeId;
    const nodeId = typeof nodeIdRaw === 'string' ? Number.parseInt(nodeIdRaw, 10) : nodeIdRaw;
    if (!Number.isFinite(nodeId) || nodeId <= 0) {
      throw new Error(`Invalid filestore node id: ${descriptor.source.nodeId}`);
    }
    return client.getNodeById(nodeId as number);
  }
  return client.getNodeByPath({
    backendMountId: descriptor.source.backendMountId,
    path: descriptor.source.path
  });
}

async function stageFileInput(options: {
  client: FilestoreClient;
  node: FilestoreNodeResponse;
  descriptor: DockerJobInputDescriptor;
  workspacePath: string;
  descriptorLabel: string;
}): Promise<{ bytes: number; checksum: string | null; verified: boolean | null }> {
  const { client, node, workspacePath, descriptorLabel } = options;
  const download = await client.downloadFile(node.id);
  const sizeBytes = Number.isFinite(node.sizeBytes) ? node.sizeBytes : download.totalSize;
  if (sizeBytes !== null && sizeBytes !== undefined) {
    assertWithinLimit(sizeBytes, MAX_FILE_BYTES, 'download', descriptorLabel);
  }
  return writeStreamToFile(download, workspacePath, sizeBytes ?? null, node.checksum ?? download.checksum, descriptorLabel);
}

async function stageDirectoryInput(options: {
  client: FilestoreClient;
  node: FilestoreNodeResponse;
  descriptor: DockerJobInputDescriptor;
  workspacePath: string;
  descriptorLabel: string;
  logger: StageLogger;
}): Promise<{ bytes: number; files: number; checksum: string | null }>
// eslint-disable-next-line @typescript-eslint/indent
{
  const { client, node, workspacePath, descriptorLabel, logger } = options;
  await mkdir(workspacePath, { recursive: true });
  let totalBytes = 0;
  let fileCount = 0;

  const queue: { path: string }[] = [{ path: node.path }];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    let offset = 0;
    const pageSize = 100;
    for (;;) {
      const result = await client.listNodes({
        backendMountId: node.backendMountId,
        path: current.path,
        limit: pageSize,
        offset,
        depth: 1
      });
      for (const child of result.nodes) {
        if (child.path === current.path) {
          continue;
        }
        if (child.state === 'deleted') {
          continue;
        }
        if (visited.has(child.path)) {
          continue;
        }
        visited.add(child.path);
        const relative = child.path.slice(node.path.length).replace(/^\/+/, '');
        const targetRelative = relative ? ensurePosixRelativePath(relative) : '';
        const targetPath = targetRelative ? path.join(workspacePath, targetRelative) : workspacePath;
        if (child.kind === 'directory') {
          await mkdir(targetPath, { recursive: true });
          queue.push({ path: child.path });
        } else if (child.kind === 'file') {
          const { bytes } = await stageFileInput({
            client,
            node: child,
            descriptor: options.descriptor,
            workspacePath: targetPath,
            descriptorLabel: `${descriptorLabel}:${relative || child.name}`
          });
          fileCount += 1;
          totalBytes += bytes;
          if (totalBytes > MAX_DOWNLOAD_BYTES) {
            throw new Error(
              `Total download limit exceeded while staging ${descriptorLabel}: ${formatBytes(totalBytes)} > ${formatBytes(MAX_DOWNLOAD_BYTES)}`
            );
          }
        } else {
          logger('Skipping unsupported filestore node kind during directory staging', {
            path: child.path,
            kind: child.kind
          });
        }
      }
      if (result.nextOffset === null) {
        break;
      }
      offset = result.nextOffset;
    }
  }

  return { bytes: totalBytes, files: fileCount, checksum: node.checksum ?? null };
}

export async function stageFilestoreInputs(options: StageFilestoreInputsOptions): Promise<StageFilestoreInputsResult> {
  const { client, inputs, resolveWorkspacePath, workDir, definition, run, logger } = options;
  const results: StagedInputArtifact[] = [];
  let totalBytes = 0;
  let totalFiles = 0;

  if (!inputs || inputs.length === 0) {
    return { inputs: results, bytesDownloaded: 0, filesDownloaded: 0 };
  }

  for (const descriptor of inputs) {
    const label = descriptor.id ?? descriptor.workspacePath;
    const workspacePath = await resolveWorkspacePath(descriptor.workspacePath);
    let node: FilestoreNodeResponse | null = null;
    try {
      node = await gatherInputNode(client, descriptor);
    } catch (err) {
      if (descriptor.optional) {
        logger('Optional filestore input lookup failed', {
          descriptorId: descriptor.id ?? null,
          workspacePath: descriptor.workspacePath,
          error: err instanceof Error ? err.message : String(err)
        });
        continue;
      }
      throw err instanceof Error
        ? new Error(`Failed to resolve filestore input ${label}: ${err.message}`)
        : new Error(`Failed to resolve filestore input ${label}`);
    }

    if (!node) {
      if (descriptor.optional) {
        logger('Optional filestore input not found', {
          descriptorId: descriptor.id ?? null,
          workspacePath: descriptor.workspacePath
        });
        continue;
      }
      throw new Error(`Filestore input ${label} not found`);
    }

    if (node.state === 'deleted') {
      if (descriptor.optional) {
        logger('Optional filestore input skipped because node is deleted', {
          descriptorId: descriptor.id ?? null,
          nodeId: node.id
        });
        continue;
      }
      throw new Error(`Filestore input ${label} references a deleted node`);
    }

    let bytes = 0;
    let files = 0;
    let checksum: string | null = null;
    let checksumVerified: boolean | null = null;

    if (node.kind === 'file') {
      const staging = await stageFileInput({
        client,
        node,
        descriptor,
        workspacePath,
        descriptorLabel: label
      });
      bytes = staging.bytes;
      files = 1;
      checksum = staging.checksum;
      checksumVerified = staging.verified;
    } else if (node.kind === 'directory') {
      const staging = await stageDirectoryInput({
        client,
        node,
        descriptor,
        workspacePath,
        descriptorLabel: label,
        logger
      });
      bytes = staging.bytes;
      files = staging.files;
      checksum = staging.checksum;
      checksumVerified = null;
    } else {
      if (descriptor.optional) {
        logger('Optional filestore input skipped due to unsupported node kind', {
          descriptorId: descriptor.id ?? null,
          nodeKind: node.kind
        });
        continue;
      }
      throw new Error(`Unsupported filestore node kind for input ${label}: ${node.kind}`);
    }

    totalBytes += bytes;
    totalFiles += files;
    assertWithinLimit(totalBytes, MAX_DOWNLOAD_BYTES, 'download', label);

    results.push({
      id: descriptor.id ?? null,
      workspacePath: path.relative(workDir, workspacePath),
      source: descriptor.source,
      nodeId: node.id,
      backendMountId: node.backendMountId,
      path: node.path,
      kind: node.kind,
      sizeBytes: Number.isFinite(node.sizeBytes) ? node.sizeBytes : null,
      checksum: normalizeChecksum(checksum ?? node.checksum ?? null),
      contentHash: node.contentHash ?? null,
      bytesDownloaded: bytes,
      filesDownloaded: files,
      checksumVerified
    });
  }

  return {
    inputs: results,
    bytesDownloaded: totalBytes,
    filesDownloaded: totalFiles
  } satisfies StageFilestoreInputsResult;
}

async function collectLocalFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectLocalFiles(absolute);
      files.push(...nested);
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function buildUploadContext(definition: JobDefinitionRecord, run: JobRunRecord): Record<string, string> {
  const startedAt = run.startedAt ?? run.scheduledAt ?? run.createdAt;
  const startedAtIso = startedAt ?? new Date().toISOString();
  return {
    runId: run.id,
    attempt: String(run.attempt ?? 1),
    jobSlug: definition.slug,
    jobDefinitionId: definition.id,
    jobVersion: String(definition.version ?? ''),
    startedAt: startedAtIso,
    startedDate: startedAtIso.slice(0, 10)
  };
}

function resolveUploadPath(template: string, context: Record<string, string>): string {
  const rendered = renderTemplate(template, context);
  const normalized = POSIX.normalize(rendered);
  if (normalized.includes('..')) {
    throw new Error(`Upload path template resolves outside allowed scope: ${template}`);
  }
  const trimmed = normalized.replace(/^\/+/, '');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export async function collectFilestoreOutputs(
  options: CollectFilestoreOutputsOptions
): Promise<CollectFilestoreOutputsResult> {
  const { client, outputs, resolveWorkspacePath, definition, run, logger } = options;
  const results: UploadedArtifact[] = [];
  let totalBytes = 0;
  let totalFiles = 0;

  if (!outputs || outputs.length === 0) {
    return { outputs: results, bytesUploaded: 0, filesUploaded: 0 };
  }

  const context = buildUploadContext(definition, run);

  for (const descriptor of outputs) {
    const workspaceTarget = await resolveWorkspacePath(descriptor.workspacePath);
    const uploadTarget = descriptor.upload;
    const resolvedPath = resolveUploadPath(uploadTarget.pathTemplate, context);
    const stats = await stat(workspaceTarget).catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    });

    if (!stats) {
      if (descriptor.optional) {
        logger('Optional filestore output skipped because workspace file was not found', {
          descriptorId: descriptor.id ?? null,
          workspacePath: descriptor.workspacePath
        });
        continue;
      }
      throw new Error(`Expected output ${descriptor.workspacePath} not found in workspace`);
    }

    if (isReadableFile(stats)) {
      const sizeBytes = stats.size;
      assertWithinLimit(sizeBytes, MAX_FILE_BYTES, 'upload', descriptor.workspacePath);
      assertWithinLimit(totalBytes + sizeBytes, MAX_UPLOAD_BYTES, 'upload', descriptor.workspacePath);
      const stream = createReadStream(workspaceTarget);
      const response = await client.uploadFile({
        backendMountId: uploadTarget.backendMountId,
        path: resolvedPath,
        content: stream,
        contentType: uploadTarget.contentType ?? undefined,
        overwrite: uploadTarget.overwrite ?? false,
        metadata: {
          uploadedBy: 'core.docker-runner',
          jobRunId: run.id,
          jobSlug: definition.slug,
          jobDefinitionId: definition.id,
          attempt: run.attempt,
          startedAt: run.startedAt
        }
      });
      if (!response.node) {
        throw new Error(`Filestore upload did not return node metadata for ${resolvedPath}`);
      }
      totalBytes += sizeBytes;
      totalFiles += 1;
      results.push({
        id: descriptor.id ?? null,
        workspacePath: descriptor.workspacePath,
        backendMountId: uploadTarget.backendMountId,
        resolvedPath,
        declaredPathTemplate: uploadTarget.pathTemplate,
        nodeId: response.node.id,
        bytesUploaded: sizeBytes,
        fileCount: 1,
        checksum: normalizeChecksum(response.node.checksum ?? null),
        contentHash: response.node.contentHash ?? null
      });
      continue;
    }

    if (isDirectory(stats)) {
      const files = await collectLocalFiles(workspaceTarget);
      let uploadedFiles = 0;
      let uploadedBytes = 0;
      const createdDirectories = new Set<string>();

      for (const filePath of files) {
        const fileStats = await stat(filePath);
        if (!isReadableFile(fileStats)) {
          continue;
        }
        const relative = ensurePosixRelativePath(path.relative(workspaceTarget, filePath));
        const remotePath = resolveUploadPath(POSIX.join(uploadTarget.pathTemplate, relative), context);
        const parentDir = POSIX.dirname(remotePath);
        if (!createdDirectories.has(parentDir)) {
          await client.createDirectory({
            backendMountId: uploadTarget.backendMountId,
            path: parentDir,
            metadata: {
              createdBy: 'core.docker-runner',
              jobRunId: run.id
            }
          }).catch(() => undefined);
          createdDirectories.add(parentDir);
        }
        assertWithinLimit(fileStats.size, MAX_FILE_BYTES, 'upload', remotePath);
        assertWithinLimit(totalBytes + uploadedBytes + fileStats.size, MAX_UPLOAD_BYTES, 'upload', remotePath);
        const response = await client.uploadFile({
          backendMountId: uploadTarget.backendMountId,
          path: remotePath,
          content: createReadStream(filePath),
          contentType: uploadTarget.contentType ?? undefined,
          overwrite: uploadTarget.overwrite ?? false,
          metadata: {
            uploadedBy: 'core.docker-runner',
            jobRunId: run.id,
            jobSlug: definition.slug,
            jobDefinitionId: definition.id,
            attempt: run.attempt,
            sourceRelativePath: relative
          }
        });
        uploadedFiles += 1;
        uploadedBytes += fileStats.size;
        results.push({
          id: descriptor.id ?? null,
          workspacePath: POSIX.join(descriptor.workspacePath, relative),
          backendMountId: uploadTarget.backendMountId,
          resolvedPath: remotePath,
          declaredPathTemplate: uploadTarget.pathTemplate,
          nodeId: response.node?.id ?? null,
          bytesUploaded: fileStats.size,
          fileCount: 1,
          checksum: normalizeChecksum(response.node?.checksum ?? null),
          contentHash: response.node?.contentHash ?? null
        });
      }

      totalBytes += uploadedBytes;
      totalFiles += uploadedFiles;
      continue;
    }

    if (descriptor.optional) {
      logger('Optional filestore output skipped due to unsupported file type', {
        descriptorId: descriptor.id ?? null,
        workspacePath: descriptor.workspacePath
      });
      continue;
    }

    throw new Error(`Unsupported output artifact type at ${descriptor.workspacePath}`);
  }

  return {
    outputs: results,
    bytesUploaded: totalBytes,
    filesUploaded: totalFiles
  } satisfies CollectFilestoreOutputsResult;
}
