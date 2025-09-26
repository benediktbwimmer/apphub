import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ensureNamespaceAccess, ensureScope } from './helpers';
import { serializeRecord } from './serializers';
import {
  createRecord,
  fetchRecord,
  upsertRecord,
  softDeleteRecord,
  searchRecords,
  OptimisticLockError
} from '../db/recordsRepository';
import { withConnection, withTransaction } from '../db/client';
import {
  parseBulkRequestPayload,
  parseCreateRecordPayload,
  parseDeleteRecordPayload,
  parseSearchPayload,
  parseUpdateRecordPayload
} from '../schemas/records';
import { HttpError, toHttpError } from './errors';
import { hasScope } from '../auth/identity';

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
  const httpLike = toHttpError(err);
  if (httpLike) {
    return httpLike;
  }
  return new HttpError(500, 'internal_error', err instanceof Error ? err.message : 'Unknown error');
}

export async function registerRecordRoutes(app: FastifyInstance): Promise<void> {
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

      reply.code(created ? 201 : 200).send({
        created,
        record: serializeRecord(record)
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

      reply.code(result.created ? 201 : 200).send({
        created: result.created,
        record: serializeRecord(result.record)
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

      reply.send({
        deleted: true,
        record: serializeRecord(record)
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

    try {
      const { records, total } = await withConnection((client) =>
        searchRecords(client, {
          namespace: payload.namespace,
          includeDeleted: payload.includeDeleted,
          filter: payload.filter,
          limit: payload.limit,
          offset: payload.offset,
          sort: payload.sort
        })
      );

      reply.send({
        pagination: {
          total,
          limit: payload.limit ?? 50,
          offset: payload.offset ?? 0
        },
        records: records.map(serializeRecord)
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
      const results = await withTransaction(async (client) => {
        const responses: unknown[] = [];
        for (const operation of payload.operations) {
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
            responses.push({
              type: 'delete',
              namespace: operation.namespace,
              key: operation.key,
              record: serializeRecord(deleted)
            });
            continue;
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

          responses.push({
            type: 'upsert',
            namespace: operation.namespace,
            key: operation.key,
            created: result.created,
            record: serializeRecord(result.record)
          });
        }

        return responses;
      });

      reply.send({
        operations: results
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
}
