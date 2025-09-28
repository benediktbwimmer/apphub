import type { FastifyInstance } from 'fastify';
import { ensureScope } from './helpers';
import { parseSchemaDefinitionPayload } from '../schemas/schemaRegistry';
import { registerSchemaDefinition } from '../schemaRegistry/service';

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.post('/admin/tokens/reload', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:admin')) {
      return;
    }

    const { count } = app.auth.reloadTokens();
    reply.send({
      reloaded: true,
      tokenCount: count
    });
  });

  app.post('/admin/schemas', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:admin')) {
      return;
    }

    let payload;
    try {
      payload = parseSchemaDefinitionPayload(request.body);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid schema definition';
      reply.code(400).send({
        statusCode: 400,
        error: 'bad_request',
        message
      });
      return;
    }

    try {
      const result = await registerSchemaDefinition(payload, request.log);
      reply.code(result.created ? 201 : 200).send({
        created: result.created,
        schema: result.definition
      });
    } catch (err) {
      request.log.error({ err, schemaHash: payload.schemaHash }, 'Failed to register schema definition');
      reply.code(500).send({
        statusCode: 500,
        error: 'internal_error',
        message: 'Failed to register schema definition'
      });
    }
  });
}
