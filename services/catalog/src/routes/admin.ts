import type { FastifyInstance } from 'fastify';
import { nukeCatalogDatabase } from '../db/index';
import { clearServiceConfigImports } from '../serviceConfigLoader';

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.post('/admin/catalog/nuke', async (request, reply) => {
    try {
      const result = await nukeCatalogDatabase();
      const importClearResult = await clearServiceConfigImports();

      if (importClearResult.errors.length > 0) {
        for (const entry of importClearResult.errors) {
          request.log.error(
            { path: entry.path, error: entry.error.message },
            'Failed to clear imported service manifest'
          );
        }
        reply.status(500);
        return { error: 'Failed to clear imported service manifests' };
      }

      request.log.warn(
        {
          repositoriesDeleted: result.repositories,
          buildsDeleted: result.builds,
          launchesDeleted: result.launches,
          tagsDeleted: result.tags,
          serviceConfigImportsCleared: importClearResult.cleared.length
        },
        'Catalog database nuked'
      );
      reply.status(200);
      return {
        data: {
          ...result,
          serviceConfigImportsCleared: importClearResult.cleared.length,
          serviceConfigImportsSkipped: importClearResult.skipped.length
        }
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to nuke catalog database');
      reply.status(500);
      return { error: 'Failed to nuke catalog database' };
    }
  });
}
