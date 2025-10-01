import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ExampleCoreData } from '@apphub/examples';
import { getExampleCore } from '../examples/coreService';

const coreQuerySchema = z
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

type CoreResponse = {
  generatedAt: string;
  core: ExampleCoreData;
};

export async function registerExampleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/examples/core', async (request, reply) => {
    const parsedQuery = coreQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      reply.status(400);
      return { error: parsedQuery.error.flatten() };
    }

    const reload = parsedQuery.data.reload ?? false;

    try {
      const data = await getExampleCore({ reload });
      const payload: CoreResponse = {
        generatedAt: new Date().toISOString(),
        core: data
      };
      reply.status(200);
      return { data: payload };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to load example core');
      reply.status(500);
      return { error: 'Failed to load example core' };
    }
  });
}
