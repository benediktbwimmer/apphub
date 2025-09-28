import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { ensureNamespaceAccess, ensureScope } from './helpers';
import { serializeRecord } from './serializers';
import {
  createRecord,
  fetchRecord,
  upsertRecord,
  softDeleteRecord,
  searchRecords,
  OptimisticLockError,
  patchRecord,
  hardDeleteRecord,
  RecordDeletedError,
  restoreRecordFromAudit
} from '../db/recordsRepository';
import { withConnection, withTransaction } from '../db/client';
import {
  parseBulkRequestPayload,
  parseCreateRecordPayload,
  parseDeleteRecordPayload,
  parseSearchPayload,
  parseUpdateRecordPayload,
  parsePatchRecordPayload,
  parsePurgeRecordPayload,
  parseAuditQuery,
  parseRestoreRecordPayload
} from '../schemas/records';
import { HttpError, toHttpError } from './errors';
import { hasScope } from '../auth/identity';
import type { ServiceConfig } from '../config/serviceConfig';
import type { FilterNode } from '../search/types';
import { compileQueryString, mergeFilterNodes } from '../search/queryCompiler';
import { getRecordAuditById, getRecordAuditByVersion, listRecordAudits } from '../db/auditRepository';
import { serializeAuditEntry } from './serializers';
import { publishMetastoreRecordEvent } from '../events/publisher';
import { emitRecordStreamEvent, type RecordStreamAction } from '../events/recordStream';
import { buildAuditDiff } from '../audit/diff';

const includeDeletedQuerySchema = z.object({
  includeDeleted: z.coerce.boolean().optional()
});

function mapError(err: unknown): HttpError {
  if (err instanceof HttpError) {
    return err;
  }
  if (err instanceof OptimisticLockError) {
    return new HttpError(409, 'version_conflict', err.message);
  }
  if (err instanceof RecordDeletedError) {
    return new HttpError(409, 'record_deleted', err.message);
  }
  const httpLike = toHttpError(err);
  if (httpLike) {
    return httpLike;
  }
  return new HttpError(500, 'internal_error', err instanceof Error ? err.message : 'Unknown error');
}

function broadcastRecordStreamEvent(
  action: RecordStreamAction,
  record: ReturnType<typeof serializeRecord>,
  actor: string | null,
  mode?: 'soft' | 'hard'
): void {
  const version = typeof record.version === 'number' ? record.version : null;
  const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : null;
  const deletedAt = record.deletedAt === undefined ? null : record.deletedAt;

  emitRecordStreamEvent({
    action,
    namespace: record.namespace,
    key: record.key,
    version,
    occurredAt: new Date().toISOString(),
    updatedAt,
    deletedAt: deletedAt ?? null,
    actor,
    mode
  });
}

export async function registerRecordRoutes(app: FastifyInstance, config: ServiceConfig): Promise<void> {
  app.post('/records', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:write')) {
      return;
    }

    const payload = parseCreateRecordPayload(request.body);

    if (!ensureNamespaceAccess(request, reply, payload.namespace)) {
      return;
    }

    try {
      const { record, created } = await withTransaction((client) =>
        createRecord(client, {
          namespace: payload.namespace,
          key: payload.key,
          metadata: payload.metadata,
          tags: payload.tags,
          owner: payload.owner,
          schemaHash: payload.schemaHash,
          actor: request.identity.subject
        })
      );

      if (!created && record.deletedAt) {
        throw new HttpError(
          409,
          'record_deleted',
          'Record exists in soft-deleted state. Use PUT to restore or supply `includeDeleted`.'
        );
      }

      const serialized = serializeRecord(record);

      if (created) {
        broadcastRecordStreamEvent('created', serialized, request.identity?.subject ?? null);
        try {
          await publishMetastoreRecordEvent('created', {
            namespace: serialized.namespace,
            key: serialized.key,
            actor: request.identity?.subject ?? null,
            record: serialized
          });
        } catch (err) {
          request.log.error({ err }, 'Failed to publish metastore record.created event');
        }
      }

      reply.code(created ? 201 : 200).send({
        created,
        record: serialized
      });
    } catch (err) {
      const error = mapError(err);
      reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.code,
        message: error.message
      });
    }
  });

  app.put<{
    Params: { namespace: string; key: string };
  }>('/records/:namespace/:key', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:write')) {
      return;
    }

    const { namespace, key } = request.params;

    if (!ensureNamespaceAccess(request, reply, namespace)) {
      return;
    }

    const payload = parseUpdateRecordPayload(request.body);

    try {
      const result = await withTransaction((client) =>
        upsertRecord(client, {
          namespace,
          key,
          metadata: payload.metadata,
          tags: payload.tags,
          owner: payload.owner,
          schemaHash: payload.schemaHash,
          expectedVersion: payload.expectedVersion,
          actor: request.identity.subject
        })
      );

      if (!result.record) {
        throw new HttpError(500, 'upsert_failed', 'Failed to upsert record');
      }

      const serialized = serializeRecord(result.record);
      const action: RecordStreamAction = result.created ? 'created' : 'updated';

      broadcastRecordStreamEvent(action, serialized, request.identity?.subject ?? null);

      try {
        await publishMetastoreRecordEvent(result.created ? 'created' : 'updated', {
          namespace,
          key,
          actor: request.identity?.subject ?? null,
          record: serialized
        });
      } catch (err) {
        request.log.error({ err }, 'Failed to publish metastore record upsert event');
      }

      reply.code(result.created ? 201 : 200).send({
        created: result.created,
        record: serialized
      });
    } catch (err) {
      const error = mapError(err);
      reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.code,
        message: error.message
      });
    }
  });

  app.patch<{
    Params: { namespace: string; key: string };
  }>('/records/:namespace/:key', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:write')) {
      return;
    }

    const { namespace, key } = request.params;

    if (!ensureNamespaceAccess(request, reply, namespace)) {
      return;
    }

    let payload;
    try {
      payload = parsePatchRecordPayload(request.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid patch payload';
      reply.code(400).send({ statusCode: 400, error: 'bad_request', message });
      return;
    }

    try {
      const updated = await withTransaction((client) =>
        patchRecord(client, {
          namespace,
          key,
          metadataPatch: payload.metadata,
          metadataUnset: payload.metadataUnset,
          tags: payload.tags,
          owner: payload.owner,
          schemaHash: payload.schemaHash,
          expectedVersion: payload.expectedVersion,
          actor: request.identity.subject
        })
      );

      if (!updated) {
        reply.code(404).send({
          statusCode: 404,
          error: 'not_found',
          message: 'Record not found'
        });
        return;
      }

      const serialized = serializeRecord(updated);

      broadcastRecordStreamEvent('updated', serialized, request.identity?.subject ?? null);

      try {
        await publishMetastoreRecordEvent('updated', {
          namespace,
          key,
          actor: request.identity?.subject ?? null,
          record: serialized
        });
      } catch (err) {
        request.log.error({ err }, 'Failed to publish metastore record.updated event');
      }

      reply.send({
        record: serialized
      });
    } catch (err) {
      const error = mapError(err);
      reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.code,
        message: error.message
      });
    }
  });

  app.get<{
    Params: { namespace: string; key: string };
    Querystring: { includeDeleted?: string | boolean };
  }>('/records/:namespace/:key', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:read')) {
      return;
    }

    const { namespace, key } = request.params;

    if (!ensureNamespaceAccess(request, reply, namespace)) {
      return;
    }

    const query = includeDeletedQuerySchema.safeParse(request.query);
    if (!query.success) {
      reply.code(400).send({
        statusCode: 400,
        error: 'bad_request',
        message: query.error.message
      });
      return;
    }

    const record = await withConnection((client) =>
      fetchRecord(client, namespace, key, { includeDeleted: query.data.includeDeleted })
    );

    if (!record) {
      reply.code(404).send({
        statusCode: 404,
        error: 'not_found',
        message: 'Record not found'
      });
      return;
    }

    reply.send({ record: serializeRecord(record) });
  });

  app.get<{
    Params: { namespace: string; key: string };
  }>('/records/:namespace/:key/audit', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:read')) {
      return;
    }

    const { namespace, key } = request.params;

    if (!ensureNamespaceAccess(request, reply, namespace)) {
      return;
    }

    let query;
    try {
      query = parseAuditQuery(request.query);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid audit query';
      reply.code(400).send({ statusCode: 400, error: 'bad_request', message });
      return;
    }

    const result = await withConnection((client) =>
      listRecordAudits(client, {
        namespace,
        key,
        limit: query.limit,
        offset: query.offset
      })
    );

    reply.send({
      pagination: {
        total: result.total,
        limit: query.limit ?? 50,
        offset: query.offset ?? 0
      },
      entries: result.entries.map(serializeAuditEntry)
    });
  });

  app.get<{
    Params: { namespace: string; key: string; id: string };
  }>('/records/:namespace/:key/audit/:id/diff', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:read')) {
      return;
    }

    const { namespace, key, id } = request.params;

    if (!ensureNamespaceAccess(request, reply, namespace)) {
      return;
    }

    const auditId = Number.parseInt(id, 10);
    if (!Number.isSafeInteger(auditId) || auditId <= 0) {
      reply.code(400).send({
        statusCode: 400,
        error: 'bad_request',
        message: 'Audit id must be a positive integer'
      });
      return;
    }

    const entry = await withConnection((client) =>
      getRecordAuditById(client, {
        namespace,
        key,
        id: auditId
      })
    );

    if (!entry) {
      reply.code(404).send({
        statusCode: 404,
        error: 'not_found',
        message: 'Audit entry not found'
      });
      return;
    }

    const diff = buildAuditDiff(entry);
    reply.send(diff);
  });

  app.post<{
    Params: { namespace: string; key: string };
  }>('/records/:namespace/:key/restore', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:write')) {
      return;
    }

    const { namespace, key } = request.params;

    if (!ensureNamespaceAccess(request, reply, namespace)) {
      return;
    }

    let payload;
    try {
      payload = parseRestoreRecordPayload(request.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid restore payload';
      reply.code(400).send({ statusCode: 400, error: 'bad_request', message });
      return;
    }

    const entry = await withConnection((client) => {
      if (payload.auditId !== undefined) {
        return getRecordAuditById(client, {
          namespace,
          key,
          id: payload.auditId
        });
      }
      return getRecordAuditByVersion(client, {
        namespace,
        key,
        version: payload.version as number
      });
    });

    if (!entry) {
      reply.code(404).send({
        statusCode: 404,
        error: 'not_found',
        message: 'Audit entry not found'
      });
      return;
    }

    try {
      const restored = await withTransaction((client) =>
        restoreRecordFromAudit(client, {
          namespace,
          key,
          expectedVersion: payload.expectedVersion,
          actor: request.identity.subject,
          snapshot: {
            metadata: entry.metadata,
            tags: entry.tags,
            owner: entry.owner,
            schemaHash: entry.schemaHash
          }
        })
      );

      if (!restored) {
        reply.code(404).send({
          statusCode: 404,
          error: 'not_found',
          message: 'Record not found'
        });
        return;
      }

      const serialized = serializeRecord(restored);

      broadcastRecordStreamEvent('updated', serialized, request.identity?.subject ?? null);

      try {
        await publishMetastoreRecordEvent('updated', {
          namespace,
          key,
          actor: request.identity?.subject ?? null,
          record: serialized,
          restoredFrom: {
            auditId: entry.id,
            version: entry.version
          }
        });
      } catch (err) {
        request.log.error({ err }, 'Failed to publish metastore record.restore event');
      }

      reply.send({
        restored: true,
        record: serialized,
        restoredFrom: {
          auditId: entry.id,
          version: entry.version
        }
      });
    } catch (err) {
      const error = mapError(err);
      reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.code,
        message: error.message
      });
    }
  });

  app.delete<{
    Params: { namespace: string; key: string };
  }>('/records/:namespace/:key', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:delete')) {
      return;
    }

    const { namespace, key } = request.params;

    if (!ensureNamespaceAccess(request, reply, namespace)) {
      return;
    }

    const payload = parseDeleteRecordPayload(request.body);

    try {
      const record = await withTransaction((client) =>
        softDeleteRecord(client, {
          namespace,
          key,
          expectedVersion: payload.expectedVersion,
          actor: request.identity.subject
        })
      );

      if (!record) {
        reply.code(404).send({
          statusCode: 404,
          error: 'not_found',
          message: 'Record not found'
        });
        return;
      }

      const serialized = serializeRecord(record);

      broadcastRecordStreamEvent('deleted', serialized, request.identity?.subject ?? null, 'soft');

      try {
        await publishMetastoreRecordEvent('deleted', {
          namespace,
          key,
          actor: request.identity?.subject ?? null,
          mode: 'soft',
          record: serialized
        });
      } catch (err) {
        request.log.error({ err }, 'Failed to publish metastore record.deleted event');
      }

      reply.send({
        deleted: true,
        record: serialized
      });
    } catch (err) {
      const error = mapError(err);
      reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.code,
        message: error.message
      });
    }
  });

  app.delete<{
    Params: { namespace: string; key: string };
  }>('/records/:namespace/:key/purge', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:admin')) {
      return;
    }

    const { namespace, key } = request.params;

    if (!ensureNamespaceAccess(request, reply, namespace)) {
      return;
    }

    const payload = parsePurgeRecordPayload(request.body);

    try {
      const record = await withTransaction((client) =>
        hardDeleteRecord(client, {
          namespace,
          key,
          expectedVersion: payload.expectedVersion
        })
      );

      if (!record) {
        reply.code(404).send({
          statusCode: 404,
          error: 'not_found',
          message: 'Record not found'
        });
        return;
      }

      const serialized = serializeRecord(record);

      broadcastRecordStreamEvent('deleted', serialized, request.identity?.subject ?? null, 'hard');

      try {
        await publishMetastoreRecordEvent('deleted', {
          namespace,
          key,
          actor: request.identity?.subject ?? null,
          mode: 'hard',
          record: serialized
        });
      } catch (err) {
        request.log.error({ err }, 'Failed to publish metastore record.purged event');
      }

      reply.send({
        purged: true,
        record: serialized
      });
    } catch (err) {
      const error = mapError(err);
      reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.code,
        message: error.message
      });
    }
  });

  app.post('/records/search', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:read')) {
      return;
    }

    let payload: ReturnType<typeof parseSearchPayload>;
    try {
      payload = parseSearchPayload(request.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid search payload';
      reply.code(400).send({ statusCode: 400, error: 'bad_request', message });
      return;
    }

    if (!ensureNamespaceAccess(request, reply, payload.namespace)) {
      return;
    }

    let queryFilter: FilterNode | undefined;
    if (payload.q) {
      try {
        queryFilter = compileQueryString(payload.q);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid query string';
        reply.code(400).send({ statusCode: 400, error: 'bad_request', message });
        return;
      }
    }

    let presetFilter: FilterNode | undefined;
    if (payload.preset) {
      const preset = config.searchPresets.find((entry) => entry.name === payload.preset);
      if (!preset) {
        reply.code(400).send({
          statusCode: 400,
          error: 'bad_request',
          message: `Unknown search preset: ${payload.preset}`
        });
        return;
      }
      const allowed = preset.requiredScopes.some((scope) => hasScope(request.identity, scope));
      if (!allowed) {
        reply.code(403).send({
          statusCode: 403,
          error: 'forbidden',
          message: `Missing required scope for preset ${payload.preset}`
        });
        return;
      }
      presetFilter = preset.filter;
    }

    const combinedFilter = mergeFilterNodes([payload.filter, presetFilter, queryFilter]);

    try {
      const { records, total } = await withConnection((client) =>
        searchRecords(client, {
          namespace: payload.namespace,
          includeDeleted: payload.includeDeleted,
          filter: combinedFilter,
          limit: payload.limit,
          offset: payload.offset,
          sort: payload.sort,
          projection: payload.projection
        })
      );

      const mode = payload.projection
        ? payload.summary
          ? 'summary'
          : 'projected'
        : 'full';

      const responsePayload = {
        pagination: {
          total,
          limit: payload.limit ?? 50,
          offset: payload.offset ?? 0
        },
        records: records.map((record) => serializeRecord(record, payload.projection))
      };

      if (app.metrics.enabled) {
        const labels = [payload.namespace, mode] as const;
        const size = Buffer.byteLength(JSON.stringify(responsePayload));
        app.metrics.searchResponseBytes.labels(...labels).observe(size);
      }

      reply.send(responsePayload);
    } catch (err) {
      const error = mapError(err);
      reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.code,
        message: error.message
      });
    }
  });

  app.post('/records/bulk', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:write')) {
      return;
    }

    let payload;
    try {
      payload = parseBulkRequestPayload(request.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid bulk payload';
      reply.code(400).send({ statusCode: 400, error: 'bad_request', message });
      return;
    }

    const requiresDeleteScope = payload.operations.some((op) => op.type === 'delete');
    if (requiresDeleteScope && !hasScope(request.identity, 'metastore:delete')) {
      reply.code(403).send({
        statusCode: 403,
        error: 'forbidden',
        message: 'Missing metastore:delete scope for delete operations'
      });
      return;
    }

    for (const operation of payload.operations) {
      const namespace = operation.namespace;
      if (!ensureNamespaceAccess(request, reply, namespace)) {
        return;
      }
    }

    try {
      const continueOnError = payload.continueOnError === true;

      const executeOperation = async (
        client: PoolClient,
        operation: (typeof payload.operations)[number]
      ): Promise<Record<string, unknown>> => {
        if (operation.type === 'delete') {
          const deleted = await softDeleteRecord(client, {
            namespace: operation.namespace,
            key: operation.key,
            expectedVersion: operation.expectedVersion,
            actor: request.identity.subject
          });
          if (!deleted) {
            throw new HttpError(404, 'not_found', `Record ${operation.namespace}/${operation.key} not found`);
          }
          return {
            type: 'delete',
            namespace: operation.namespace,
            key: operation.key,
            record: serializeRecord(deleted)
          };
        }

        const result = await upsertRecord(client, {
          namespace: operation.namespace,
          key: operation.key,
          metadata: operation.metadata,
          tags: operation.tags,
          owner: operation.owner,
          schemaHash: operation.schemaHash,
          expectedVersion: operation.expectedVersion,
          actor: request.identity.subject
        });

        if (!result.record) {
          throw new HttpError(500, 'upsert_failed', `Failed to upsert record ${operation.namespace}/${operation.key}`);
        }

        return {
          type: 'upsert',
          namespace: operation.namespace,
          key: operation.key,
          created: result.created,
          record: serializeRecord(result.record)
        };
      };

      if (continueOnError) {
        const results = [] as Array<Record<string, unknown>>;
        for (const operation of payload.operations) {
          try {
            const outcome = await withTransaction((client) => executeOperation(client, operation));
            results.push({ status: 'ok', ...outcome });
          } catch (err) {
            const error = mapError(err);
            results.push({
              status: 'error',
              namespace: operation.namespace,
              key: operation.key,
              error: {
                statusCode: error.statusCode,
                code: error.code,
                message: error.message
              }
            });
          }
        }

        reply.send({ operations: results });
        return;
      }

      const results = await withTransaction(async (client) => {
        const responses: Array<Record<string, unknown>> = [];
        for (const operation of payload.operations) {
          const outcome = await executeOperation(client, operation);
          responses.push({ status: 'ok', ...outcome });
        }
        return responses;
      });

      reply.send({ operations: results });
    } catch (err) {
      const error = mapError(err);
      reply.code(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.code,
        message: error.message
      });
    }
  });
}
