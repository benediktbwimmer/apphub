import type { FastifyInstance } from 'fastify';
import { ensureScope } from './helpers';
import { withConnection } from '../db/client';
import { listNamespaces, type NamespacePage } from '../db/namespacesRepository';
import { parseNamespaceListQuery } from '../schemas/namespaces';
import { serializeNamespaceSummary } from './serializers';
import { HttpError } from './errors';

const CACHE_TTL_MS = 30_000;
const METRICS_CACHE_PREFIX = 'metrics::';

type CacheEntry = {
  expiresAt: number;
  value: NamespacePage;
};

const namespaceCache = new Map<string, CacheEntry>();

function buildCacheKey(identityNamespaces: '*' | string[], prefix: string | undefined, limit: number, offset: number): string {
  const namespacePart = identityNamespaces === '*' ? '*' : identityNamespaces.slice().sort().join(',');
  return [namespacePart, prefix ?? '', String(limit), String(offset)].join('|');
}

function getFromCache(key: string): NamespacePage | null {
  const entry = namespaceCache.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() > entry.expiresAt) {
    namespaceCache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache(key: string, value: NamespacePage): void {
  namespaceCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function updateNamespaceMetrics(
  app: FastifyInstance,
  scope: '*' | string[],
  prefix: string | undefined,
  queryOffset: number,
  page: NamespacePage
): Promise<void> {
  if (!app.metrics.enabled || scope !== '*' || queryOffset !== 0 || (prefix && prefix.length > 0)) {
    return;
  }

  let metricsPage: NamespacePage = page;

  if (page.total > page.namespaces.length) {
    const metricsKey = `${METRICS_CACHE_PREFIX}${prefix ?? ''}`;
    const cached = getFromCache(metricsKey);
    if (cached) {
      metricsPage = cached;
    } else if (page.total > 0) {
      try {
        const fullPage = await withConnection((client) =>
          listNamespaces(client, {
            limit: page.total,
            offset: 0,
            prefix,
            namespaces: '*'
          })
        );
        setCache(metricsKey, fullPage);
        metricsPage = fullPage;
      } catch (err) {
        app.log.warn({ err }, 'Failed to refresh namespace metrics snapshot');
      }
    }
  }

  app.metrics.namespaceRecords.reset();
  app.metrics.namespaceDeletedRecords.reset();

  for (const namespace of metricsPage.namespaces) {
    app.metrics.namespaceRecords.labels(namespace.name).set(namespace.totalRecords);
    app.metrics.namespaceDeletedRecords.labels(namespace.name).set(namespace.deletedRecords);
  }
}

export async function registerNamespaceRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
    Querystring: {
      prefix?: string;
      limit?: number;
      offset?: number;
    };
  }>('/namespaces', async (request, reply) => {
    if (!ensureScope(request, reply, 'metastore:read')) {
      return;
    }

    let query;
    try {
      query = parseNamespaceListQuery(request.query);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid query parameters';
      reply.code(400).send({ statusCode: 400, error: 'bad_request', message });
      return;
    }

    const prefix = query.prefix ? query.prefix.toLowerCase() : undefined;
    const namespaces = request.identity.namespaces === '*' ? '*' : Array.from(request.identity.namespaces);

    const cacheKey = buildCacheKey(namespaces, prefix, query.limit, query.offset);
    let page = getFromCache(cacheKey);

    if (!page) {
      try {
        page = await withConnection((client) =>
          listNamespaces(client, {
            limit: query.limit,
            offset: query.offset,
            prefix,
            namespaces
          })
        );
      } catch (err) {
        request.log.error({ err }, 'Failed to list namespaces');
        const statusCode = err instanceof HttpError ? err.statusCode : 500;
        const code = err instanceof HttpError ? err.code : 'internal_error';
        const message = err instanceof Error ? err.message : 'Failed to list namespaces';
        reply.code(statusCode).send({ statusCode, error: code, message });
        return;
      }

      setCache(cacheKey, page);
    }

    await updateNamespaceMetrics(app, namespaces, prefix, query.offset, page);

    const namespacesPayload = page.namespaces.map((item) => serializeNamespaceSummary(item));

    const response: {
      pagination: {
        total: number;
        limit: number;
        offset: number;
        nextOffset?: number;
      };
      namespaces: typeof namespacesPayload;
    } = {
      pagination: {
        total: page.total,
        limit: query.limit,
        offset: query.offset
      },
      namespaces: namespacesPayload
    };

    const nextOffset = query.offset + query.limit;
    if (nextOffset < page.total) {
      response.pagination.nextOffset = nextOffset;
    }

    reply.send(response);
  });
}
