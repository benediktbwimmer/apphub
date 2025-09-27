import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID, createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { MultipartFile, MultipartValue } from '@fastify/multipart';
import { runCommand } from '../../commands/orchestrator';
import {
  getBackendMountById,
  getBackendMountsByIds,
  listBackendMounts,
  type BackendMountRecord
} from '../../db/backendMounts';
import { resolveExecutor } from '../../executors/registry';
import type { ExecutorFileMetadata } from '../../executors/types';
import {
  getReconciliationJobById,
  listReconciliationJobs,
  type ReconciliationJobRecord
} from '../../db/reconciliationJobs';
import {
  getNodeById,
  getNodeByPath,
  listNodeChildren,
  listNodes,
  type NodeKind,
  type NodeRecord,
  type NodeState
} from '../../db/nodes';
import { withConnection } from '../../db/client';
import { FilestoreError } from '../../errors';
import { getRollupSummary } from '../../rollup/manager';
import type { RollupSummary } from '../../rollup/types';
import { emitNodeDownloadedEvent, subscribeToFilestoreEvents } from '../../events/publisher';
import { ensureReconciliationManager } from '../../reconciliation/manager';
import type { ReconciliationReason } from '../../reconciliation/types';
import { getNodeDepth, normalizePath } from '../../utils/path';

type ParsedChecksumHeader = {
  algorithm: 'sha256' | 'sha1' | 'md5';
  value: string;
};

const checksumAlgorithms = new Set<ParsedChecksumHeader['algorithm']>(['sha256', 'sha1', 'md5']);

function parseChecksumHeader(value: unknown): ParsedChecksumHeader | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const [maybeAlgorithm, maybeValue] = trimmed.includes(':') ? trimmed.split(':', 2) : [null, trimmed];
  if (maybeAlgorithm) {
    const algorithm = maybeAlgorithm.toLowerCase() as ParsedChecksumHeader['algorithm'];
    if (!checksumAlgorithms.has(algorithm)) {
      throw new FilestoreError('Unsupported checksum algorithm', 'INVALID_CHECKSUM', {
        algorithm: maybeAlgorithm
      });
    }
    return { algorithm, value: maybeValue.trim().toLowerCase() };
  }
  return { algorithm: 'sha256', value: maybeValue.trim().toLowerCase() };
}

function parseBooleanFormField(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  const result = preprocessBooleanQuery(value);
  return typeof result === 'boolean' ? result : undefined;
}

function parseMetadataField(raw: string | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Metadata must be a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new FilestoreError('Invalid metadata payload', 'INVALID_REQUEST', {
      message: (err as Error).message
    });
  }
}

const createDirectorySchema = z.object({
  backendMountId: z.number().int().positive(),
  path: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().min(1).optional()
});

const deleteNodeSchema = z.object({
  backendMountId: z.number().int().positive(),
  path: z.string().min(1),
  recursive: z.boolean().optional(),
  idempotencyKey: z.string().min(1).optional()
});

const nodeByPathQuerySchema = z.object({
  backendMountId: z.coerce.number().int().positive(),
  path: z.string().min(1)
});

const reconciliationRequestSchema = z.object({
  backendMountId: z.number().int().positive(),
  path: z.string().min(1),
  nodeId: z.number().int().positive().nullable().optional(),
  reason: z.enum(['drift', 'audit', 'manual']).optional(),
  detectChildren: z.boolean().optional(),
  requestedHash: z.boolean().optional()
});

const updateMetadataBodySchema = z.object({
  backendMountId: z.number().int().positive(),
  set: z.record(z.string(), z.unknown()).optional(),
  unset: z.array(z.string()).optional()
});

const moveNodeBodySchema = z.object({
  backendMountId: z.number().int().positive(),
  path: z.string().min(1),
  targetPath: z.string().min(1),
  targetBackendMountId: z.number().int().positive().optional(),
  overwrite: z.boolean().optional()
});

const copyNodeBodySchema = z.object({
  backendMountId: z.number().int().positive(),
  path: z.string().min(1),
  targetPath: z.string().min(1),
  targetBackendMountId: z.number().int().positive().optional(),
  overwrite: z.boolean().optional()
});

const nodeStateFilterSchema = z.enum(['active', 'inconsistent', 'missing', 'deleted']);
const nodeKindFilterSchema = z.enum(['file', 'directory']);

function preprocessQueryArray(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    if (value.includes(',')) {
      return value
        .split(',')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }
  return [value];
}

function preprocessBooleanQuery(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
      return false;
    }
  }
  return value;
}

const optionalStateFilterSchema = z
  .preprocess(preprocessQueryArray, z.array(nodeStateFilterSchema).min(1))
  .optional();

const optionalKindFilterSchema = z
  .preprocess(preprocessQueryArray, z.array(nodeKindFilterSchema).min(1))
  .optional();

const booleanQuerySchema = z.preprocess(preprocessBooleanQuery, z.boolean()).optional();

const reconciliationJobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'skipped', 'cancelled']);

const optionalJobStatusFilterSchema = z
  .preprocess(preprocessQueryArray, z.array(reconciliationJobStatusSchema).min(1))
  .optional();

const backendMountResponseSchema = z.object({
  data: z.object({
    mounts: z.array(
      z.object({
        id: z.number().int().positive(),
        mountKey: z.string(),
        backendKind: z.enum(['local', 's3']),
        accessMode: z.enum(['rw', 'ro']),
        state: z.string(),
        rootPath: z.string().nullable(),
        bucket: z.string().nullable(),
        prefix: z.string().nullable()
      })
    )
  })
});

const listNodesQuerySchema = z.object({
  backendMountId: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  path: z.string().min(1).optional(),
  depth: z.coerce.number().int().min(0).max(10).optional(),
  search: z.string().min(1).optional(),
  states: optionalStateFilterSchema,
  kinds: optionalKindFilterSchema,
  driftOnly: booleanQuerySchema
});

const listChildrenQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  search: z.string().min(1).optional(),
  states: optionalStateFilterSchema,
  kinds: optionalKindFilterSchema,
  driftOnly: booleanQuerySchema
});

const listReconciliationJobsQuerySchema = z.object({
  backendMountId: z.coerce.number().int().positive().optional(),
  path: z.string().min(1).optional(),
  status: optionalJobStatusFilterSchema,
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

const reconciliationJobIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

function serializeRollup(summary: RollupSummary | null) {
  if (!summary) {
    return null;
  }
  return {
    nodeId: summary.nodeId,
    sizeBytes: summary.sizeBytes,
    fileCount: summary.fileCount,
    directoryCount: summary.directoryCount,
    childCount: summary.childCount,
    state: summary.state,
    lastCalculatedAt: summary.lastCalculatedAt ? summary.lastCalculatedAt.toISOString() : null
  };
}

type NodeDownloadDescriptor = {
  mode: 'stream' | 'presign';
  streamUrl: string;
  presignUrl: string | null;
  supportsRange: boolean;
  sizeBytes: number | null;
  checksum: string | null;
  contentHash: string | null;
  filename: string | null;
};

function buildDownloadDescriptor(
  node: NodeRecord,
  backendKind: BackendMountRecord['backendKind'] | undefined
): NodeDownloadDescriptor | null {
  if (node.kind !== 'file') {
    return null;
  }
  if (node.state === 'deleted') {
    return null;
  }

  const mode: NodeDownloadDescriptor['mode'] = backendKind === 's3' ? 'presign' : 'stream';
  const sizeBytes = Number.isFinite(node.sizeBytes) ? node.sizeBytes : null;

  return {
    mode,
    streamUrl: `/v1/files/${node.id}/content`,
    presignUrl: backendKind === 's3' ? `/v1/files/${node.id}/presign` : null,
    supportsRange: true,
    sizeBytes,
    checksum: node.checksum ?? null,
    contentHash: node.contentHash ?? null,
    filename: node.name ?? null
  } satisfies NodeDownloadDescriptor;
}

async function serializeNode(node: NodeRecord, backendKind?: BackendMountRecord['backendKind']) {
  let resolvedBackendKind = backendKind;
  if (!resolvedBackendKind) {
    const backend = await withConnection((client) =>
      getBackendMountById(client, node.backendMountId, { forUpdate: false })
    );
    resolvedBackendKind = backend?.backendKind;
  }

  const rollup = await getRollupSummary(node.id);
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
    state: node.state,
    version: node.version,
    isSymlink: node.isSymlink,
    lastSeenAt: node.lastSeenAt,
    lastModifiedAt: node.lastModifiedAt,
    consistencyState: node.consistencyState,
    consistencyCheckedAt: node.consistencyCheckedAt,
    lastReconciledAt: node.lastReconciledAt,
    lastDriftDetectedAt: node.lastDriftDetectedAt,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    deletedAt: node.deletedAt,
    rollup: serializeRollup(rollup),
    download: buildDownloadDescriptor(node, resolvedBackendKind)
  };
}

function serializeReconciliationJobRecord(job: ReconciliationJobRecord) {
  return {
    id: job.id,
    jobKey: job.jobKey,
    backendMountId: job.backendMountId,
    nodeId: job.nodeId,
    path: job.path,
    reason: job.reason,
    status: job.status,
    detectChildren: job.detectChildren,
    requestedHash: job.requestedHash,
    attempt: job.attempt,
    result: job.result ?? null,
    error: job.error ?? null,
    enqueuedAt: job.enqueuedAt.toISOString(),
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    durationMs: job.durationMs ?? null,
    updatedAt: job.updatedAt.toISOString()
  };
}

function mapFilestoreErrorToHttpStatus(err: FilestoreError): number {
  switch (err.code) {
    case 'INVALID_PATH':
      return 400;
    case 'BACKEND_NOT_FOUND':
    case 'NODE_NOT_FOUND':
    case 'PARENT_NOT_FOUND':
      return 404;
    case 'NODE_EXISTS':
      return 409;
    case 'NOT_A_DIRECTORY':
    case 'CHILDREN_EXIST':
    case 'IDEMPOTENCY_CONFLICT':
    case 'EXECUTOR_NOT_FOUND':
      return 409;
    case 'INVALID_REQUEST':
    case 'INVALID_CHECKSUM':
    case 'NOT_SUPPORTED':
      return 400;
    case 'CHECKSUM_MISMATCH':
      return 422;
    default:
      return 500;
  }
}

function sendError(reply: FastifyReply, err: unknown) {
  if (err instanceof FilestoreError) {
    const status = mapFilestoreErrorToHttpStatus(err);
    return reply.status(status).send({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? null
      }
    });
  }

  reply.log.error({ err }, 'unhandled error in filestore route');
  return reply.status(500).send({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unexpected error occurred'
    }
  });
}

function resolvePrincipal(headers: Record<string, unknown>): string | undefined {
  const candidate = headers['x-filestore-principal'] ?? headers['x-request-principal'];
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return undefined;
}

function resolveIdempotencyKey(
  bodyKey: string | undefined,
  headers: Record<string, unknown>
): string | undefined {
  if (bodyKey) {
    return bodyKey;
  }
  const headerKey = headers['idempotency-key'] ?? headers['x-idempotency-key'];
  if (typeof headerKey === 'string' && headerKey.trim().length > 0) {
    return headerKey.trim();
  }
  return undefined;
}

type ByteRange = {
  start: number;
  end: number;
};

function parseRangeHeader(raw: string, totalSize: number): ByteRange | null {
  const trimmed = raw.trim();
  if (!trimmed.toLowerCase().startsWith('bytes=')) {
    return null;
  }
  const spec = trimmed.slice(6);
  const [startPart, endPart] = spec.split('-', 2);
  if (!startPart && !endPart) {
    return null;
  }

  let start: number;
  let end: number;

  if (!startPart) {
    const suffixLength = Number.parseInt(endPart ?? '', 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    if (suffixLength >= totalSize) {
      start = 0;
    } else {
      start = totalSize - suffixLength;
    }
    end = totalSize > 0 ? totalSize - 1 : 0;
  } else {
    start = Number.parseInt(startPart, 10);
    if (!Number.isFinite(start) || start < 0) {
      return null;
    }
    if (start >= totalSize) {
      return null;
    }
    if (endPart) {
      end = Number.parseInt(endPart, 10);
      if (!Number.isFinite(end) || end < start) {
        return null;
      }
      if (end >= totalSize) {
        end = totalSize > 0 ? totalSize - 1 : 0;
      }
    } else {
      end = totalSize > 0 ? totalSize - 1 : 0;
    }
  }

  return { start, end } satisfies ByteRange;
}

function rangeLength(range: ByteRange): number {
  return range.end - range.start + 1;
}

function formatContentRange(range: ByteRange, totalSize: number): string {
  return `bytes ${range.start}-${range.end}/${totalSize}`;
}

function buildContentDisposition(filename: string | null): string {
  if (!filename) {
    return 'attachment';
  }
  const sanitized = filename.replace(/"/g, "'");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${sanitized}"; filename*=UTF-8''${encoded}`;
}

function extractScopes(headers: Record<string, unknown>): Set<string> {
  const scopes = new Set<string>();
  const keys = ['x-iam-scopes', 'x-apphub-scopes'];
  for (const key of keys) {
    const value = headers[key];
    if (typeof value === 'string') {
      value
        .split(',')
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0)
        .forEach((scope) => scopes.add(scope));
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry !== 'string') {
          continue;
        }
        entry
          .split(',')
          .map((scope) => scope.trim())
          .filter((scope) => scope.length > 0)
          .forEach((scope) => scopes.add(scope));
      }
    }
  }
  return scopes;
}

function requireWriteScope(request: FastifyRequest, reply: FastifyReply): boolean {
  const scopes = extractScopes(request.headers as Record<string, unknown>);
  if (scopes.has('filestore:write') || scopes.has('filestore:admin')) {
    return true;
  }
  reply.status(403).send({
    error: {
      code: 'FORBIDDEN',
      message: 'filestore:write scope required'
    }
  });
  return false;
}

export async function registerV1Routes(app: FastifyInstance): Promise<void> {
  app.get('/v1/backend-mounts', async (request, reply) => {
    const mounts = await withConnection((client) => listBackendMounts(client));

    const payload = backendMountResponseSchema.parse({
      data: {
        mounts: mounts.map((mount) => ({
          id: mount.id,
          mountKey: mount.mountKey,
          backendKind: mount.backendKind,
          accessMode: mount.accessMode,
          state: mount.state,
          rootPath: mount.rootPath,
          bucket: mount.bucket,
          prefix: mount.prefix
        }))
      }
    });

    reply.send(payload);
  });

  app.post('/v1/files', async (request, reply) => {
    if (typeof (request as any).isMultipart !== 'function' || !(request as any).isMultipart()) {
      return reply.status(415).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'File uploads require multipart/form-data'
        }
      });
    }

    const parts = (request as any).parts();
    let filePart: MultipartFile | null = null;
    const fields = new Map<string, string>();

    try {
      for await (const part of parts as AsyncIterable<MultipartFile | MultipartValue>) {
        if (part.type === 'file') {
          const candidate = part as MultipartFile;
          if (filePart) {
            candidate.file.resume();
            return reply.status(400).send({
              error: {
                code: 'INVALID_REQUEST',
                message: 'Exactly one file must be provided'
              }
            });
          }
          filePart = candidate;
          break;
        }
        if (part.type === 'field' && typeof part.value === 'string') {
          fields.set(part.fieldname, part.value);
        }
      }
    } catch (err) {
      return sendError(reply, err);
    }

    if (!filePart) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'File payload missing'
        }
      });
    }

    const backendMountValue = fields.get('backendMountId') ?? fields.get('backend_mount_id');
    const backendMountId = backendMountValue ? Number(backendMountValue) : Number.NaN;
    if (!Number.isFinite(backendMountId) || backendMountId <= 0) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'backendMountId must be a positive integer'
        }
      });
    }

    const pathValue = fields.get('path');
    if (!pathValue || pathValue.trim().length === 0) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'path field is required'
        }
      });
    }

    let normalizedPath: string;
    try {
      normalizedPath = normalizePath(pathValue);
    } catch (err) {
      return sendError(reply, err);
    }

    let metadata: Record<string, unknown> | undefined;
    try {
      metadata = parseMetadataField(fields.get('metadata'));
    } catch (err) {
      return sendError(reply, err);
    }

    const overwrite = parseBooleanFormField(fields.get('overwrite')) ?? false;
    const idempotencyKey = resolveIdempotencyKey(fields.get('idempotencyKey'), request.headers);
    const principal = resolvePrincipal(request.headers);

    let checksumHeader: ParsedChecksumHeader | null = null;
    let contentHashHeader: ParsedChecksumHeader | null = null;
    try {
      checksumHeader = parseChecksumHeader(request.headers['x-filestore-checksum']);
      contentHashHeader = parseChecksumHeader(request.headers['x-filestore-content-hash']);
    } catch (err) {
      return sendError(reply, err);
    }

    const stagingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'filestore-upload-'));
    const stagingPath = path.join(stagingDir, randomUUID());
    const writeStream = createWriteStream(stagingPath);
    let totalBytes = 0;

    const hashers = new Map<ParsedChecksumHeader['algorithm'], ReturnType<typeof createHash>>();
    hashers.set('sha256', createHash('sha256'));
    if (checksumHeader) {
      if (!hashers.has(checksumHeader.algorithm)) {
        hashers.set(checksumHeader.algorithm, createHash(checksumHeader.algorithm));
      }
    }
    if (contentHashHeader) {
      if (!hashers.has(contentHashHeader.algorithm)) {
        hashers.set(contentHashHeader.algorithm, createHash(contentHashHeader.algorithm));
      }
    }

    const tracker = new Transform({
      transform(chunk, _encoding, callback) {
        totalBytes += chunk.length;
        hashers.forEach((hasher) => hasher.update(chunk));
        callback(null, chunk);
      }
    });

    try {
      await pipeline(filePart.file, tracker, writeStream);
    } catch (err) {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      return sendError(reply, err);
    }

    const digests = new Map<ParsedChecksumHeader['algorithm'], string>();
    for (const [algorithm, hasher] of hashers.entries()) {
      digests.set(algorithm, hasher.digest('hex'));
    }

    const checksumDigest = checksumHeader ? digests.get(checksumHeader.algorithm) ?? null : null;
    const contentHashDigest = contentHashHeader
      ? digests.get(contentHashHeader.algorithm) ?? null
      : digests.get('sha256') ?? null;
    const sha256Digest = digests.get('sha256') ?? null;

    if (checksumHeader && checksumDigest && checksumDigest !== checksumHeader.value) {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      return reply.status(422).send({
        error: {
          code: 'CHECKSUM_MISMATCH',
          message: 'Uploaded file checksum does not match expected value'
        }
      });
    }

    if (contentHashHeader && contentHashDigest && contentHashDigest !== contentHashHeader.value) {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      return reply.status(422).send({
        error: {
          code: 'CHECKSUM_MISMATCH',
          message: 'Uploaded file content hash does not match expected value'
        }
      });
    }

    const existing = await withConnection((client) => getNodeByPath(client, backendMountId, normalizedPath));
    if (existing && existing.kind === 'directory') {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      return reply.status(409).send({
        error: {
          code: 'NODE_EXISTS',
          message: 'Cannot upload file over a directory'
        }
      });
    }

    if (existing && existing.state !== 'deleted' && existing.kind === 'file' && !overwrite) {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      return reply.status(409).send({
        error: {
          code: 'NODE_EXISTS',
          message: 'File already exists at path; set overwrite to true to replace it'
        }
      });
    }

    const commandBase: Record<string, unknown> = {
      backendMountId,
      path: normalizedPath,
      stagingPath,
      sizeBytes: totalBytes,
      checksum: checksumDigest ?? checksumHeader?.value ?? null,
      contentHash: contentHashDigest ?? sha256Digest
    };

    const mimeType = filePart.mimetype && filePart.mimetype.trim().length > 0 ? filePart.mimetype : null;
    if (mimeType) {
      commandBase.mimeType = mimeType;
    }

    const originalName = filePart.filename && filePart.filename.trim().length > 0 ? filePart.filename : null;
    if (originalName) {
      commandBase.originalName = originalName;
    }

    if (metadata !== undefined) {
      commandBase.metadata = metadata;
    }

    const command = existing && existing.state !== 'deleted'
      ? {
          type: 'writeFile' as const,
          nodeId: existing.id,
          ...commandBase
        }
      : {
          type: 'uploadFile' as const,
          ...commandBase
        };

    try {
      const result = await runCommand({
        command,
        principal,
        idempotencyKey
      });

      const nodePayload = result.node ? await serializeNode(result.node) : null;
      const created = command.type === 'uploadFile' && (!existing || existing.state === 'deleted');
      const status = result.idempotent ? 200 : created ? 201 : 200;

      return reply.status(status).send({
        data: {
          idempotent: result.idempotent,
          journalEntryId: result.journalEntryId,
          node: nodePayload,
          result: result.result
        }
      });
    } catch (err) {
      return sendError(reply, err);
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  app.get('/v1/files/:id/content', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'File id must be a positive integer'
        }
      });
    }

    try {
      const { node, backend } = await withConnection(async (client) => {
        const nodeRecord = await getNodeById(client, id);
        if (!nodeRecord) {
          return { node: null, backend: null } as const;
        }
        const backendRecord = await getBackendMountById(client, nodeRecord.backendMountId, {
          forUpdate: false
        });
        return { node: nodeRecord, backend: backendRecord } as const;
      });

      if (!node) {
        return reply.status(404).send({
          error: {
            code: 'NODE_NOT_FOUND',
            message: 'File not found'
          }
        });
      }

      if (!backend) {
        throw new FilestoreError('Backend mount not found', 'BACKEND_NOT_FOUND', {
          backendMountId: node.backendMountId
        });
      }

      if (node.kind !== 'file') {
        return reply.status(409).send({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Requested node is not a file'
          }
        });
      }

      if (node.state === 'deleted') {
        return reply.status(404).send({
          error: {
            code: 'NODE_NOT_FOUND',
            message: 'File has been deleted'
          }
        });
      }

      const executor = resolveExecutor(backend.backendKind);
      if (!executor || typeof executor.createReadStream !== 'function') {
        throw new FilestoreError('Executor does not support downloads', 'NOT_SUPPORTED', {
          backendKind: backend.backendKind
        });
      }

      let metadata = null as ExecutorFileMetadata | null;
      if (typeof executor.head === 'function') {
        metadata = await executor.head(node.path, { backend });
        if (metadata === null) {
          return reply.status(404).send({
            error: {
              code: 'NODE_NOT_FOUND',
              message: 'File content missing from backend'
            }
          });
        }
      }

      const reportedSize = metadata?.sizeBytes;
      const totalSize = typeof reportedSize === 'number' && reportedSize >= 0 ? reportedSize : Number.isFinite(node.sizeBytes) ? node.sizeBytes : null;
      const rangeHeader = typeof request.headers.range === 'string' ? request.headers.range : undefined;
      let range: ByteRange | null = null;
      if (rangeHeader) {
        if (totalSize === null) {
          reply.header('Content-Range', 'bytes */*');
          return reply.status(416).send({
            error: {
              code: 'INVALID_REQUEST',
              message: 'Range requests require known file size'
            }
          });
        }
        range = parseRangeHeader(rangeHeader, totalSize);
        if (!range) {
          reply.header('Content-Range', `bytes */${totalSize}`);
          return reply.status(416).send({
            error: {
              code: 'INVALID_REQUEST',
              message: 'Invalid Range header'
            }
          });
        }
      }

      const readResult = await executor.createReadStream(node.path, { backend }, range ? { range } : undefined);

      const stream = readResult.stream;
      if (!stream) {
        throw new FilestoreError('Executor did not return a stream', 'INVALID_REQUEST', {
          backendKind: backend.backendKind
        });
      }

      const chunkLength =
        typeof readResult.contentLength === 'number'
          ? readResult.contentLength
          : range
            ? rangeLength(range)
            : totalSize;
      const resolvedTotal = readResult.totalSize ?? totalSize;
      const contentRangeHeader =
        readResult.contentRange ??
        (range && resolvedTotal !== null ? formatContentRange(range, resolvedTotal) : null);

      reply.header('Cache-Control', 'private, max-age=0, must-revalidate');
      reply.header('Content-Disposition', buildContentDisposition(node.name));
      reply.header('Content-Type', readResult.contentType ?? metadata?.contentType ?? 'application/octet-stream');

      if (chunkLength !== null && chunkLength !== undefined) {
        reply.header('Content-Length', String(chunkLength));
      }
      if (resolvedTotal !== null) {
        reply.header('Accept-Ranges', 'bytes');
      }
      if (contentRangeHeader) {
        reply.header('Content-Range', contentRangeHeader);
      }

      const lastModified = readResult.lastModifiedAt ?? metadata?.lastModifiedAt ?? node.lastModifiedAt;
      if (lastModified) {
        const lastModifiedDate = lastModified instanceof Date ? lastModified : new Date(lastModified);
        if (!Number.isNaN(lastModifiedDate.getTime())) {
          reply.header('Last-Modified', lastModifiedDate.toUTCString());
        }
      }

      const checksumValue = metadata?.checksum ?? node.checksum ?? null;
      if (checksumValue) {
        reply.header('x-filestore-checksum', checksumValue);
      }

      const hashValue = readResult.etag ?? metadata?.contentHash ?? node.contentHash ?? null;
      if (hashValue) {
        const normalizedHash = hashValue.includes(':') ? hashValue.split(':', 2)[1] ?? hashValue : hashValue;
        reply.header('ETag', `"${normalizedHash.replace(/"/g, '')}"`);
        reply.header('x-filestore-content-hash', hashValue);
      }

      const principal = resolvePrincipal(request.headers) ?? null;
      const observedAt = new Date().toISOString();
      void emitNodeDownloadedEvent({
        backendMountId: node.backendMountId,
        nodeId: node.id,
        path: node.path,
        sizeBytes: chunkLength ?? resolvedTotal ?? null,
        checksum: checksumValue ?? null,
        contentHash: hashValue ?? null,
        principal,
        mode: 'stream',
        range: range ? `${range.start}-${range.end}` : null,
        observedAt
      }).catch((err) => {
        request.log.error({ err }, 'failed to publish download event');
      });

      reply.status(range ? 206 : 200);
      return reply.send(stream);
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/v1/files/:id/presign', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'File id must be a positive integer'
        }
      });
    }

    try {
      const { node, backend } = await withConnection(async (client) => {
        const nodeRecord = await getNodeById(client, id);
        if (!nodeRecord) {
          return { node: null, backend: null } as const;
        }
        const backendRecord = await getBackendMountById(client, nodeRecord.backendMountId, {
          forUpdate: false
        });
        return { node: nodeRecord, backend: backendRecord } as const;
      });

      if (!node) {
        return reply.status(404).send({
          error: {
            code: 'NODE_NOT_FOUND',
            message: 'File not found'
          }
        });
      }

      if (!backend) {
        throw new FilestoreError('Backend mount not found', 'BACKEND_NOT_FOUND', {
          backendMountId: node.backendMountId
        });
      }

      if (node.kind !== 'file') {
        return reply.status(409).send({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Requested node is not a file'
          }
        });
      }

      if (node.state === 'deleted') {
        return reply.status(404).send({
          error: {
            code: 'NODE_NOT_FOUND',
            message: 'File has been deleted'
          }
        });
      }

      const executor = resolveExecutor(backend.backendKind);
      if (!executor || typeof executor.createPresignedDownload !== 'function') {
        throw new FilestoreError('Backend does not support presigned downloads', 'NOT_SUPPORTED', {
          backendKind: backend.backendKind
        });
      }

      const expiresInSecondsParam = typeof (request.query as Record<string, unknown>).expiresIn === 'string'
        ? Number.parseInt((request.query as Record<string, string>).expiresIn, 10)
        : undefined;
      const expiresInSeconds = Number.isFinite(expiresInSecondsParam) && expiresInSecondsParam! > 0
        ? Math.min(expiresInSecondsParam!, 3600)
        : 300;

      const presign = await executor.createPresignedDownload(node.path, { backend }, {
        expiresInSeconds
      });

      const responsePayload = {
        url: presign.url,
        expiresAt: presign.expiresAt.toISOString(),
        headers: presign.headers ?? {},
        method: presign.method ?? 'GET'
      };

      const principal = resolvePrincipal(request.headers) ?? null;
      const observedAt = new Date().toISOString();
      void emitNodeDownloadedEvent({
        backendMountId: node.backendMountId,
        nodeId: node.id,
        path: node.path,
        sizeBytes: Number.isFinite(node.sizeBytes) ? node.sizeBytes : null,
        checksum: node.checksum ?? null,
        contentHash: node.contentHash ?? null,
        principal,
        mode: 'presign',
        range: null,
        observedAt
      }).catch((err) => {
        request.log.error({ err }, 'failed to publish presign event');
      });

      return reply.status(200).send({ data: responsePayload });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/v1/directories', async (request, reply) => {
    const parseResult = createDirectorySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid directory payload',
          details: parseResult.error.flatten()
        }
      });
    }

    const payload = parseResult.data;
    const idempotencyKey = resolveIdempotencyKey(payload.idempotencyKey, request.headers);
    const principal = resolvePrincipal(request.headers);

    try {
      const result = await runCommand({
        command: {
          type: 'createDirectory',
          backendMountId: payload.backendMountId,
          path: payload.path,
          metadata: payload.metadata
        },
        idempotencyKey,
        principal
      });

      const status = result.idempotent ? 200 : 201;
      const nodePayload = result.node ? await serializeNode(result.node) : null;
      return reply.status(status).send({
        data: {
          idempotent: result.idempotent,
          journalEntryId: result.journalEntryId,
          node: nodePayload,
          result: result.result
        }
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.delete('/v1/nodes', async (request, reply) => {
    const parseResult = deleteNodeSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid delete payload',
          details: parseResult.error.flatten()
        }
      });
    }

    const payload = parseResult.data;
    const idempotencyKey = resolveIdempotencyKey(payload.idempotencyKey, request.headers);
    const principal = resolvePrincipal(request.headers);

    try {
      const result = await runCommand({
        command: {
          type: 'deleteNode',
          backendMountId: payload.backendMountId,
          path: payload.path,
          recursive: payload.recursive
        },
        idempotencyKey,
        principal
      });

      const nodePayload = result.node ? await serializeNode(result.node) : null;
      return reply.status(200).send({
        data: {
          idempotent: result.idempotent,
          journalEntryId: result.journalEntryId,
          node: nodePayload,
          result: result.result
        }
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/v1/nodes/move', async (request, reply) => {
    const parseResult = moveNodeBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid move payload',
          details: parseResult.error.flatten()
        }
      });
    }

    const payload = parseResult.data;
    const principal = resolvePrincipal(request.headers);
    const idempotencyKey = resolveIdempotencyKey(undefined, request.headers);

    try {
      const result = await runCommand({
        command: {
          type: 'moveNode',
          backendMountId: payload.backendMountId,
          path: payload.path,
          targetPath: payload.targetPath,
          targetBackendMountId: payload.targetBackendMountId,
          overwrite: payload.overwrite
        },
        principal,
        idempotencyKey
      });

      const nodePayload = result.node ? await serializeNode(result.node) : null;
      return reply.status(200).send({
        data: {
          journalEntryId: result.journalEntryId,
          idempotent: result.idempotent,
          node: nodePayload,
          result: result.result
        }
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.post('/v1/nodes/copy', async (request, reply) => {
    const parseResult = copyNodeBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid copy payload',
          details: parseResult.error.flatten()
        }
      });
    }

    const payload = parseResult.data;
    const principal = resolvePrincipal(request.headers);
    const idempotencyKey = resolveIdempotencyKey(undefined, request.headers);

    try {
      const result = await runCommand({
        command: {
          type: 'copyNode',
          backendMountId: payload.backendMountId,
          path: payload.path,
          targetPath: payload.targetPath,
          targetBackendMountId: payload.targetBackendMountId,
          overwrite: payload.overwrite
        },
        principal,
        idempotencyKey
      });

      const nodePayload = result.node ? await serializeNode(result.node) : null;
      return reply.status(201).send({
        data: {
          journalEntryId: result.journalEntryId,
          idempotent: result.idempotent,
          node: nodePayload,
          result: result.result
        }
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.patch('/v1/nodes/:id/metadata', async (request, reply) => {
    const nodeId = Number((request.params as { id: string }).id);
    if (!Number.isFinite(nodeId) || nodeId <= 0) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Node id must be a positive integer'
        }
      });
    }

    const parseResult = updateMetadataBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid metadata payload',
          details: parseResult.error.flatten()
        }
      });
    }

    const payload = parseResult.data;
    const principal = resolvePrincipal(request.headers);
    const idempotencyKey = resolveIdempotencyKey(undefined, request.headers);

    try {
      const result = await runCommand({
        command: {
          type: 'updateNodeMetadata',
          backendMountId: payload.backendMountId,
          nodeId,
          set: payload.set,
          unset: payload.unset
        },
        principal,
        idempotencyKey
      });

      const nodePayload = result.node ? await serializeNode(result.node) : null;
      return reply.status(200).send({
        data: {
          journalEntryId: result.journalEntryId,
          idempotent: result.idempotent,
          node: nodePayload,
          result: result.result
        }
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/v1/nodes', async (request, reply) => {
    const parseResult = listNodesQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid query parameters',
          details: parseResult.error.flatten()
        }
      });
    }

    const query = parseResult.data;
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const driftOnly = query.driftOnly ?? false;
    const stateFilters = (query.states ?? undefined) as NodeState[] | undefined;
    const kindFilters = (query.kinds ?? undefined) as NodeKind[] | undefined;
    const searchTerm = query.search?.trim();

    let pathPrefix: string | undefined;
    if (query.path) {
      try {
        pathPrefix = normalizePath(query.path);
      } catch (err) {
        return sendError(reply, err);
      }
    }

    const maxDepth =
      typeof query.depth === 'number'
        ? pathPrefix
          ? getNodeDepth(pathPrefix) + query.depth
          : query.depth
        : undefined;

    try {
      const result = await withConnection((client) =>
        listNodes(client, {
          backendMountId: query.backendMountId,
          limit,
          offset,
          pathPrefix,
          maxDepth,
          states: stateFilters,
          kinds: kindFilters,
          searchTerm: searchTerm ?? undefined,
          driftOnly
        })
      );

      const backendIds = Array.from(new Set(result.nodes.map((node) => node.backendMountId)));
      const backendMap = await withConnection((client) => getBackendMountsByIds(client, backendIds));
      const nodesPayload = await Promise.all(
        result.nodes.map((node) =>
          serializeNode(node, backendMap.get(node.backendMountId)?.backendKind)
        )
      );
      const nextOffset = offset + nodesPayload.length < result.total ? offset + nodesPayload.length : null;

      return reply.status(200).send({
        data: {
          nodes: nodesPayload,
          pagination: {
            total: result.total,
            limit,
            offset,
            nextOffset
          },
          filters: {
            backendMountId: query.backendMountId,
            path: pathPrefix ?? null,
            depth: typeof query.depth === 'number' ? query.depth : null,
            states: query.states ?? [],
            kinds: query.kinds ?? [],
            search: searchTerm ?? null,
            driftOnly
          }
        }
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/v1/nodes/:id/children', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Node id must be a positive integer'
        }
      });
    }

    const parseResult = listChildrenQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid query parameters',
          details: parseResult.error.flatten()
        }
      });
    }

    let parent: NodeRecord | null;
    try {
      parent = await withConnection((client) => getNodeById(client, id));
    } catch (err) {
      return sendError(reply, err);
    }

    if (!parent) {
      return reply.status(404).send({
        error: {
          code: 'NODE_NOT_FOUND',
          message: 'Node not found'
        }
      });
    }

    const query = parseResult.data;
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    const driftOnly = query.driftOnly ?? false;
    const stateFilters = (query.states ?? undefined) as NodeState[] | undefined;
    const kindFilters = (query.kinds ?? undefined) as NodeKind[] | undefined;
    const searchTerm = query.search?.trim();

    try {
      const result = await withConnection((client) =>
        listNodeChildren(client, id, {
          limit,
          offset,
          states: stateFilters,
          kinds: kindFilters,
          searchTerm: searchTerm ?? undefined,
          driftOnly
        })
      );

      const backendIds = new Set<number>([parent.backendMountId, ...result.nodes.map((node) => node.backendMountId)]);
      const backendMap = await withConnection((client) => getBackendMountsByIds(client, Array.from(backendIds)));
      const parentPayload = await serializeNode(
        parent,
        backendMap.get(parent.backendMountId)?.backendKind
      );
      const childrenPayload = await Promise.all(
        result.nodes.map((node) =>
          serializeNode(node, backendMap.get(node.backendMountId)?.backendKind)
        )
      );
      const nextOffset = offset + childrenPayload.length < result.total ? offset + childrenPayload.length : null;

      return reply.status(200).send({
        data: {
          parent: parentPayload,
          children: childrenPayload,
          pagination: {
            total: result.total,
            limit,
            offset,
            nextOffset
          },
          filters: {
            states: query.states ?? [],
            kinds: query.kinds ?? [],
            search: searchTerm ?? null,
            driftOnly
          }
        }
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/v1/nodes/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Node id must be a positive integer'
        }
      });
    }

    const node = await withConnection((client) => getNodeById(client, id));
    if (!node) {
      return reply.status(404).send({
        error: {
          code: 'NODE_NOT_FOUND',
          message: 'Node not found'
        }
      });
    }

    return reply.status(200).send({ data: await serializeNode(node) });
  });

  app.get('/v1/nodes/by-path', async (request, reply) => {
    const parseResult = nodeByPathQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid query parameters',
          details: parseResult.error.flatten()
        }
      });
    }

    const query = parseResult.data;
    const node = await withConnection((client) =>
      getNodeByPath(client, query.backendMountId, query.path)
    );

    if (!node) {
      return reply.status(404).send({
        error: {
          code: 'NODE_NOT_FOUND',
          message: 'Node not found'
        }
      });
    }

    return reply.status(200).send({ data: await serializeNode(node) });
  });

  app.post('/v1/reconciliation', async (request, reply) => {
    const parseResult = reconciliationRequestSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid reconciliation payload',
          details: parseResult.error.flatten()
        }
      });
    }

    const payload = parseResult.data;
    const manager = ensureReconciliationManager();
    await manager.enqueue({
      backendMountId: payload.backendMountId,
      path: payload.path,
      nodeId: payload.nodeId ?? null,
      reason: (payload.reason ?? 'manual') as ReconciliationReason,
      detectChildren: payload.detectChildren,
      requestedHash: payload.requestedHash
    });

    return reply.status(202).send({ data: { enqueued: true } });
  });

  app.get('/v1/reconciliation/jobs', async (request, reply) => {
    if (!requireWriteScope(request, reply)) {
      return;
    }

    const parseResult = listReconciliationJobsQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid reconciliation job query',
          details: parseResult.error.flatten()
        }
      });
    }

    const query = parseResult.data;
    const limit = query.limit ? Math.min(query.limit, 200) : 50;
    const offset = query.offset ?? 0;
    const normalizedPath = query.path ? query.path.trim() : undefined;

    try {
      const result = await withConnection((client) =>
        listReconciliationJobs(client, {
          backendMountId: query.backendMountId,
          path: normalizedPath,
          status: query.status,
          limit,
          offset
        })
      );

      const jobs = result.jobs.map(serializeReconciliationJobRecord);
      const nextOffset = offset + jobs.length < result.total ? offset + jobs.length : null;

      return reply.status(200).send({
        data: {
          jobs,
          pagination: {
            total: result.total,
            limit,
            offset,
            nextOffset
          },
          filters: {
            backendMountId: query.backendMountId ?? null,
            path: normalizedPath ?? null,
            status: query.status ?? []
          }
        }
      });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/v1/reconciliation/jobs/:id', async (request, reply) => {
    if (!requireWriteScope(request, reply)) {
      return;
    }

    const parseResult = reconciliationJobIdParamsSchema.safeParse(request.params);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid reconciliation job identifier',
          details: parseResult.error.flatten()
        }
      });
    }

    try {
      const job = await withConnection((client) =>
        getReconciliationJobById(client, parseResult.data.id)
      );
      if (!job) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Reconciliation job not found'
          }
        });
      }
      return reply.status(200).send({ data: serializeReconciliationJobRecord(job) });
    } catch (err) {
      return sendError(reply, err);
    }
  });

  app.get('/v1/events/stream', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    if (typeof reply.raw.flushHeaders === 'function') {
      reply.raw.flushHeaders();
    }

    reply.hijack();
    reply.raw.write(':connected\n\n');

    const unsubscribe = subscribeToFilestoreEvents((event) => {
      try {
        const payload = JSON.stringify({ type: event.type, data: event.data });
        reply.raw.write(`event: ${event.type}\n`);
        reply.raw.write(`data: ${payload}\n\n`);
      } catch (err) {
        request.log.error({ err }, 'failed to write SSE payload');
      }
    });

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(':ping\n\n');
      } catch (err) {
        request.log.error({ err }, 'failed to write SSE heartbeat');
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
}
