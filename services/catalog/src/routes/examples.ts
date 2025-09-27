import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ExampleCatalogData } from '@apphub/examples';
import { getExampleCatalog } from '../examples/catalogService';

const catalogQuerySchema = z
  .object({
    reload: z
      .string()
      .trim()
      .toLowerCase()
      .transform((value) => value === 'true' || value === '1')
      .optional()
  })
  .strict()
  .partial();

type CatalogResponse = {
  generatedAt: string;
  catalog: ExampleCatalogData;
};

export async function registerExampleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/examples/catalog', async (request, reply) => {
    const parsedQuery = catalogQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      reply.status(400);
      return { error: parsedQuery.error.flatten() };
    }

    const reload = parsedQuery.data.reload ?? false;

    try {
      const data = await getExampleCatalog({ reload });
      const payload: CatalogResponse = {
        generatedAt: new Date().toISOString(),
        catalog: data
      };
      reply.status(200);
      return { data: payload };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to load example catalog');
      reply.status(500);
      return { error: 'Failed to load example catalog' };
    }
  });
}
