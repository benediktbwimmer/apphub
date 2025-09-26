import type { FastifyInstance } from 'fastify';
import { ensureScope } from './helpers';

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
}
