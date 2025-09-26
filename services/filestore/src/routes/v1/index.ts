import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { runCommand } from '../../commands/orchestrator';
import { getNodeById, getNodeByPath, type NodeRecord } from '../../db/nodes';
import { withConnection } from '../../db/client';
import { FilestoreError } from '../../errors';
import { getRollupSummary } from '../../rollup/manager';
import type { RollupSummary } from '../../rollup/types';
import { subscribeToFilestoreEvents } from '../../events/publisher';
import { ensureReconciliationManager } from '../../reconciliation/manager';
import type { ReconciliationReason } from '../../reconciliation/types';

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

async function serializeNode(node: NodeRecord) {
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
    rollup: serializeRollup(rollup)
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

export async function registerV1Routes(app: FastifyInstance): Promise<void> {
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
