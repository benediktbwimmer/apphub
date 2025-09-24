import type { FastifyInstance } from 'fastify';
import { nukeCatalogDatabase, nukeCatalogRunData } from '../db/index';
import { clearServiceConfigImports } from '../serviceConfigLoader';

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.post('/admin/catalog/nuke/run-data', async (request, reply) => {
    try {
      const counts = await nukeCatalogRunData();
      request.log.warn(
        {
          buildsDeleted: counts.builds ?? 0,
          launchesDeleted: counts.launches ?? 0,
          serviceNetworkLaunchMembersDeleted: counts.service_network_launch_members ?? 0,
          serviceNetworkMembersDeleted: counts.service_network_members ?? 0,
          serviceNetworksDeleted: counts.service_networks ?? 0
        },
        'Catalog run data nuked'
      );
      reply.status(200);
      return {
        data: {
          builds: counts.builds ?? 0,
          launches: counts.launches ?? 0,
          counts
        }
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to nuke catalog run data');
      reply.status(500);
      return { error: 'Failed to nuke catalog run data' };
    }
  });

  app.post('/admin/catalog/nuke', async (request, reply) => {
    try {
      const counts = await nukeCatalogDatabase();
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
          repositoriesDeleted: counts.repositories ?? 0,
          buildsDeleted: counts.builds ?? 0,
          launchesDeleted: counts.launches ?? 0,
          tagsDeleted: counts.tags ?? 0,
          serviceNetworkLaunchMembersDeleted: counts.service_network_launch_members ?? 0,
          serviceNetworkMembersDeleted: counts.service_network_members ?? 0,
          serviceNetworksDeleted: counts.service_networks ?? 0,
          repositoryPreviewsDeleted: counts.repository_previews ?? 0,
          repositoryTagsDeleted: counts.repository_tags ?? 0,
          ingestionEventsDeleted: counts.ingestion_events ?? 0,
          repositorySearchEntriesDeleted: counts.repository_search ?? 0,
          servicesDeleted: counts.services ?? 0,
          serviceConfigImportsCleared: importClearResult.cleared.length
        },
        'Catalog database nuked'
      );
      reply.status(200);
      return {
        data: {
          repositories: counts.repositories ?? 0,
          builds: counts.builds ?? 0,
          launches: counts.launches ?? 0,
          tags: counts.tags ?? 0,
          counts,
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
