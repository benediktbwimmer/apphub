import type { FastifyInstance } from 'fastify';
import {
  ensureDatabase,
  listWorkflowEvents,
  markDatabaseUninitialized,
  nukeCatalogDatabase,
  nukeCatalogEverything,
  nukeCatalogRunData
} from '../db/index';
import { resetServiceManifestState } from '../serviceRegistry';

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/events', async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;

    const type = typeof query.type === 'string' ? query.type.trim() : undefined;
    const source = typeof query.source === 'string' ? query.source.trim() : undefined;

    const parseTimestamp = (value: unknown, field: string): string | undefined => {
      if (value === undefined || value === null) {
        return undefined;
      }
      if (typeof value !== 'string') {
        throw new Error(`${field} must be a string ISO-8601 timestamp`);
      }
      const trimmed = value.trim();
      if (!trimmed) {
        return undefined;
      }
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`${field} must be a valid ISO-8601 timestamp`);
      }
      return parsed.toISOString();
    };

    let from: string | undefined;
    let to: string | undefined;

    try {
      from = parseTimestamp(query.from, 'from');
      to = parseTimestamp(query.to, 'to');
    } catch (err) {
      reply.status(400);
      return { error: (err as Error).message };
    }

    let limit: number | undefined;
    if (query.limit !== undefined) {
      const value = typeof query.limit === 'number' ? query.limit : Number.parseInt(String(query.limit), 10);
      if (!Number.isFinite(value)) {
        reply.status(400);
        return { error: 'limit must be a positive integer' };
      }
      limit = value;
    }

    try {
      const events = await listWorkflowEvents({
        type: type && type.length > 0 ? type : undefined,
        source: source && source.length > 0 ? source : undefined,
        from,
        to,
        limit
      });
      reply.status(200);
      return { data: events };
    } catch (err) {
      request.log.error({ err }, 'Failed to list workflow events');
      reply.status(500);
      return { error: 'Failed to list workflow events' };
    }
  });

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
      resetServiceManifestState();

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
          servicesDeleted: counts.services ?? 0
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
          counts
        }
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to nuke catalog database');
      reply.status(500);
      return { error: 'Failed to nuke catalog database' };
    }
  });

  app.post('/admin/catalog/nuke/everything', async (request, reply) => {
    try {
      const counts = await nukeCatalogEverything();
      resetServiceManifestState();

      markDatabaseUninitialized();
      await ensureDatabase();

      const totalRowsDeleted = Object.values(counts).reduce((acc, value) => acc + value, 0);

      request.log.warn(
        {
          tablesTruncated: Object.keys(counts).length,
          totalRowsDeleted,
          counts
        },
        'Entire catalog database nuked'
      );
      reply.status(200);
      return {
        data: {
          counts,
          totalRowsDeleted
        }
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to nuke entire catalog database');
      reply.status(500);
      return { error: 'Failed to nuke entire catalog database' };
    }
  });
}
