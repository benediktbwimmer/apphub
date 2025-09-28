import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ensureScope } from './helpers';
import type { ServiceConfig } from '../config/serviceConfig';
import { fetchSchemaDefinitionCached } from '../schemaRegistry/service';

const schemaHashParamsSchema = z.object({
  hash: z
    .string()
    .trim()
    .min(6, 'schema hash must be at least 6 characters')
    .max(256, 'schema hash must be at most 256 characters')
});

function toCacheControlHeader(ttlMs: number): string {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return 'no-store';
  }
  const seconds = Math.max(1, Math.floor(ttlMs / 1_000));
  return `public, max-age=${seconds}`;
}

export async function registerSchemaRoutes(app: FastifyInstance, config: ServiceConfig): Promise<void> {
  const positiveTtlMs = config.schemaRegistry.cacheTtlMs;
  const negativeTtlMs = config.schemaRegistry.negativeCacheTtlMs;

  app.get<{
    Params: { hash: string };
  }>('/schemas/:hash', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:read')) {
      return;
    }

    let schemaHash: string;
    try {
      const parsed = schemaHashParamsSchema.parse(request.params);
      schemaHash = parsed.hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid schema hash';
      reply.code(400).send({ statusCode: 400, error: 'bad_request', message });
      return;
    }

    try {
      const result = await fetchSchemaDefinitionCached(schemaHash, {
        logger: request.log,
        metrics: app.metrics
      });

      if (result.status === 'found') {
        reply
          .header('Cache-Control', toCacheControlHeader(positiveTtlMs))
          .send({
            schemaHash: result.definition.schemaHash,
            name: result.definition.name,
            description: result.definition.description,
            version: result.definition.version,
            metadata: result.definition.metadata,
            fields: result.definition.fields,
            createdAt: result.definition.createdAt,
            updatedAt: result.definition.updatedAt,
            cache: result.source
          });
        return;
      }

      reply
        .header('Cache-Control', toCacheControlHeader(negativeTtlMs))
        .code(404)
        .send({
          statusCode: 404,
          error: 'schema_not_found',
          message: 'Schema metadata not registered. Submit via /admin/schemas or the CLI script to register definitions.'
        });
    } catch (err) {
      request.log.error({ err, schemaHash }, 'Failed to resolve schema definition');
      reply.code(500).send({
        statusCode: 500,
        error: 'internal_error',
        message: 'Unable to load schema definition'
      });
    }
  });
}
