import type { FastifyInstance } from 'fastify';
import { ensureScope } from './helpers';
import { getFilestoreHealthSnapshot } from '../filestore/consumer';

export async function registerFilestoreRoutes(app: FastifyInstance): Promise<void> {
  app.get('/filestore/health', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:read')) {
      return;
    }

    const snapshot = getFilestoreHealthSnapshot();
    const statusCode = snapshot.status === 'stalled' || snapshot.status === 'error' ? 503 : 200;
    reply.code(statusCode).send(snapshot);
  });
}
