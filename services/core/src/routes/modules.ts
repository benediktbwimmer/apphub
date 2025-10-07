import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { ModuleCatalogData } from '@apphub/module-registry';
import { getModuleCatalog } from '../modules/catalogService';
import { listModuleResourceContextsForModule } from '../db/moduleResourceContexts';
import { listModules } from '../db/modules';
import type { ModuleResourceContextRecord, ModuleResourceType, ModuleRecord } from '../db/types';

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

const moduleResourceTypes = [
  'service',
  'service-network',
  'workflow-definition',
  'workflow-run',
  'job-definition',
  'job-run',
  'asset',
  'event',
  'view',
  'metric'
] as const satisfies readonly ModuleResourceType[];

const moduleResourceParamsSchema = z.object({
  moduleId: z.string().trim().min(1)
});

const moduleResourceQuerySchema = z
  .object({
    resourceType: z.enum(moduleResourceTypes).optional()
  })
  .strict()
  .partial();

type CatalogResponse = {
  generatedAt: string;
  catalog: ModuleCatalogData;
};

export async function registerModuleRoutes(app: FastifyInstance): Promise<void> {
  app.get('/modules/catalog', async (request, reply) => {
    const parsedQuery = catalogQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      reply.status(400);
      return { error: parsedQuery.error.flatten() };
    }

    const reload = parsedQuery.data.reload ?? false;

    try {
      const data = await getModuleCatalog({ reload });
      const payload: CatalogResponse = {
        generatedAt: new Date().toISOString(),
        catalog: data
      };
      reply.status(200);
      return { data: payload };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to load module catalog');
      reply.status(500);
      return { error: 'Failed to load module catalog' };
    }
  });

  app.get('/modules', async (request, reply) => {
    try {
      const modules: ModuleRecord[] = await listModules();
      reply.status(200);
      return { data: modules };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to list modules');
      reply.status(500);
      return { error: 'Failed to list modules' };
    }
  });

  app.get('/modules/:moduleId/resources', async (request, reply) => {
    const parsedParams = moduleResourceParamsSchema.safeParse(request.params ?? {});
    if (!parsedParams.success) {
      reply.status(400);
      return { error: parsedParams.error.flatten() };
    }

    const parsedQuery = moduleResourceQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      reply.status(400);
      return { error: parsedQuery.error.flatten() };
    }

    const moduleId = parsedParams.data.moduleId;
    const resourceType = parsedQuery.data.resourceType;

    try {
      const resources: ModuleResourceContextRecord[] = await listModuleResourceContextsForModule(moduleId, {
        resourceType
      });
      reply.status(200);
      return {
        data: {
          moduleId,
          resourceType: resourceType ?? null,
          resources
        }
      };
    } catch (error) {
      request.log.error({ err: error, moduleId }, 'Failed to load module resource contexts');
      reply.status(500);
      return { error: 'Failed to load module resource contexts' };
    }
  });
}
