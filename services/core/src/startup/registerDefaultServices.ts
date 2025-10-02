import type { FastifyBaseLogger } from 'fastify';
import { getServiceBySlug, upsertService } from '../db';
import { mergeServiceMetadata } from '../serviceMetadata';

type DefaultServiceDefinition = {
  slug: string;
  displayName: string;
  kind: string;
  envVar: string;
  fallbackUrl: string;
  healthEndpoint: string;
};

const DEFAULT_SERVICES: DefaultServiceDefinition[] = [
  {
    slug: 'metastore',
    displayName: 'Metastore API',
    kind: 'metastore',
    envVar: 'APPHUB_METASTORE_BASE_URL',
    fallbackUrl: 'http://127.0.0.1:4100',
    healthEndpoint: '/healthz'
  },
  {
    slug: 'filestore',
    displayName: 'Filestore API',
    kind: 'filestore',
    envVar: 'APPHUB_FILESTORE_BASE_URL',
    fallbackUrl: 'http://127.0.0.1:4300',
    healthEndpoint: '/healthz'
  },
  {
    slug: 'timestore',
    displayName: 'Timestore API',
    kind: 'timestore',
    envVar: 'APPHUB_TIMESTORE_BASE_URL',
    fallbackUrl: 'http://127.0.0.1:4200',
    healthEndpoint: '/health'
  }
];

function normalizeBaseUrl(rawValue: string | undefined | null): string | null {
  if (!rawValue) {
    return null;
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.search = '';
    if (url.pathname && url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    const serialized = url.toString();
    return serialized.endsWith('/') && url.pathname === '' ? serialized.slice(0, -1) : serialized;
  } catch {
    return null;
  }
}

export async function registerDefaultServices(logger: FastifyBaseLogger): Promise<void> {
  for (const definition of DEFAULT_SERVICES) {
    const configuredUrl = normalizeBaseUrl(process.env[definition.envVar]);
    const baseUrl = configuredUrl ?? normalizeBaseUrl(definition.fallbackUrl);
    if (!baseUrl) {
      logger.warn(
        { slug: definition.slug, configuredUrl: process.env[definition.envVar] ?? null },
        'Skipped default service registration due to invalid base URL'
      );
      continue;
    }

    try {
      const existing = await getServiceBySlug(definition.slug);
      const metadata = mergeServiceMetadata(existing?.metadata ?? null, {
        resourceType: 'service',
        manifest: {
          source: 'apphub.defaults',
          baseUrlSource: 'config',
          healthEndpoint: definition.healthEndpoint
        }
      });

      await upsertService({
        slug: definition.slug,
        displayName: definition.displayName,
        kind: definition.kind,
        baseUrl,
        source: 'external',
        metadata
      });

      logger.info(
        { slug: definition.slug, baseUrl },
        existing ? 'Updated default service registration' : 'Registered default service'
      );
    } catch (err) {
      logger.error({ err, slug: definition.slug }, 'Failed to register default service');
    }
  }
}
