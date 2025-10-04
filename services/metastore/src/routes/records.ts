import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ensureNamespaceAccess, ensureScope } from './helpers';
import { serializeAuditEntry, serializeRecord } from './serializers';
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
import { hasScope } from '../auth/identity';
import type { ServiceConfig } from '../config/serviceConfig';
import type { FilterNode } from '../search/types';
import { compileQueryString, mergeFilterNodes } from '../search/queryCompiler';
import { getRecordAuditById, listRecordAudits } from '../db/auditRepository';
import { buildAuditDiff } from '../audit/diff';
import { withConnection } from '../db/client';
import { createRecordService, type OperationContext } from '../services/recordService';

const includeDeletedQuerySchema = z.object({
  includeDeleted: z.coerce.boolean().optional()
});

function buildOperationContext(request: FastifyRequest): OperationContext {
  return {
    actor: request.identity?.subject ?? null,
    logger: request.log
  };
}

export async function registerRecordRoutes(app: FastifyInstance, config: ServiceConfig): Promise<void> {
  const recordService = createRecordService();

  app.post('/records', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:write')) {
      return;
    }

    const payload = parseCreateRecordPayload(request.body);

    if (!ensureNamespaceAccess(request, reply, payload.namespace)) {
      return;
    }

    const result = await recordService.createRecord(payload, buildOperationContext(request));

    reply.code(result.created ? 201 : 200).send(result);
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

    const result = await recordService.upsertRecord(namespace, key, payload, buildOperationContext(request));

    reply.code(result.created ? 201 : 200).send(result);
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

    const result = await recordService.patchRecord(namespace, key, payload, buildOperationContext(request));

    reply.send(result);
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

    const record = await recordService.fetchRecord(namespace, key, {
      includeDeleted: query.data.includeDeleted
    });

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

    const result = await recordService.restoreRecord(namespace, key, payload, buildOperationContext(request));

    reply.send(result);
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

    const result = await recordService.softDeleteRecord(namespace, key, payload, buildOperationContext(request));

    reply.send(result);
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

    const result = await recordService.hardDeleteRecord(namespace, key, payload, buildOperationContext(request));

    reply.send(result);
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

    const { records, total } = await recordService.searchRecords({
      namespace: payload.namespace,
      includeDeleted: payload.includeDeleted,
      filter: combinedFilter,
      limit: payload.limit,
      offset: payload.offset,
      sort: payload.sort,
      projection: payload.projection,
      search: payload.search
    });

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
      if (!ensureNamespaceAccess(request, reply, operation.namespace)) {
        return;
      }
    }

    const results = await recordService.bulkOperations(payload, buildOperationContext(request));

    reply.send({ operations: results });
  });
}
