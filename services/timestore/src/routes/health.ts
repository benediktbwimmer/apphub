import type { FastifyInstance } from 'fastify';
import { withConnection } from '../db/client';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async () => {
    await withConnection(async (client) => {
      await client.query('SELECT 1');
    });
    return { status: 'ready' };
  });
}
