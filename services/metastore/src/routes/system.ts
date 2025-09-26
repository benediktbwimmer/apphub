import type { FastifyInstance } from 'fastify';
import { withConnection } from '../db/client';

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async () => {
    await withConnection(async (client) => {
      await client.query('SELECT 1 AS readiness_check');
    });
    return { status: 'ok' };
  });
}
