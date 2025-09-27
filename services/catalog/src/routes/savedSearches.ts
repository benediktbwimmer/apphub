import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createSavedCatalogSearch,
  deleteSavedCatalogSearch,
  getSavedCatalogSearchBySlug,
  listSavedCatalogSearches,
  recordSavedCatalogSearchApplied,
  recordSavedCatalogSearchShared,
  updateSavedCatalogSearch,
  type SavedCatalogSearchCreateInput,
  type SavedCatalogSearchRecord,
  type SavedCatalogSearchUpdateInput,
  type SavedCatalogSearchOwner
} from '../db/savedSearches';
import { requireOperatorScopes, type OperatorAuthSuccess } from './shared/operatorAuth';

const STATUS_VALUES = ['seed', 'pending', 'processing', 'ready', 'failed'] as const;
const SORT_VALUES = ['relevance', 'updated', 'name'] as const;

const savedSearchCreateSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.union([z.string().max(500), z.null()]).optional(),
    searchInput: z.string().max(500),
    statusFilters: z
      .array(z.enum(STATUS_VALUES))
      .max(5)
      .optional(),
    sort: z.enum(SORT_VALUES).optional()
  })
  .strict();

const savedSearchUpdateSchema = savedSearchCreateSchema.partial().strict();

const savedSearchSlugParamsSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(120)
  })
  .strict();

function resolveOwner(auth: OperatorAuthSuccess): SavedCatalogSearchOwner {
  const identity = auth.identity;
  const userId = identity.userId ?? null;
  const tokenHash = identity.tokenHash ?? null;
  const sessionId = identity.sessionId ?? null;

  const ownerKey = userId
    ? `user:${userId}`
    : tokenHash
      ? `token:${tokenHash}`
      : sessionId
        ? `session:${sessionId}`
        : `subject:${identity.subject}`;

  return {
    key: ownerKey,
    userId,
    subject: identity.subject,
    kind: identity.kind,
    tokenHash
  } satisfies SavedCatalogSearchOwner;
}

function serializeSavedSearch(record: SavedCatalogSearchRecord) {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    searchInput: record.searchInput,
    statusFilters: record.statusFilters,
    sort: record.sort,
    visibility: record.visibility,
    appliedCount: record.appliedCount,
    sharedCount: record.sharedCount,
    lastAppliedAt: record.lastAppliedAt,
    lastSharedAt: record.lastSharedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function normalizeDescriptionInput(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toCreateInput(payload: z.infer<typeof savedSearchCreateSchema>): SavedCatalogSearchCreateInput {
  const description = normalizeDescriptionInput(payload.description);

  return {
    name: payload.name,
    description: description ?? null,
    searchInput: payload.searchInput,
    statusFilters: payload.statusFilters,
    sort: payload.sort
  } satisfies SavedCatalogSearchCreateInput;
}

function toUpdateInput(payload: z.infer<typeof savedSearchUpdateSchema>): SavedCatalogSearchUpdateInput {
  const description = normalizeDescriptionInput(payload.description);

  return {
    name: payload.name,
    description,
    searchInput: payload.searchInput,
    statusFilters: payload.statusFilters,
    sort: payload.sort
  } satisfies SavedCatalogSearchUpdateInput;
}

export async function registerSavedSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/saved-searches', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'catalog.saved-searches.list',
      resource: 'catalog/saved-searches',
      requiredScopes: []
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const owner = resolveOwner(authResult.auth);
    const searches = await listSavedCatalogSearches(owner);
    reply.status(200);
    return {
      data: searches.map(serializeSavedSearch)
    };
  });

  app.post('/saved-searches', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'catalog.saved-searches.create',
      resource: 'catalog/saved-searches',
      requiredScopes: []
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parse = savedSearchCreateSchema.safeParse(request.body ?? {});
    if (!parse.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parse.error.flatten()
      });
      return { error: parse.error.flatten() };
    }

    try {
      const owner = resolveOwner(authResult.auth);
      const record = await createSavedCatalogSearch(owner, toCreateInput(parse.data));
      reply.status(201);
      await authResult.auth.log('succeeded', {
        action: 'catalog.saved-searches.create',
        slug: record.slug
      });
      return { data: serializeSavedSearch(record) };
    } catch (err) {
      request.log.error({ err }, 'Failed to create saved catalog search');
      reply.status(500);
      await authResult.auth.log('failed', {
        reason: 'exception',
        message: err instanceof Error ? err.message : 'unknown_error'
      });
      return { error: 'failed_to_create_saved_search' };
    }
  });

  app.get('/saved-searches/:slug', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'catalog.saved-searches.get',
      resource: 'catalog/saved-searches',
      requiredScopes: []
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = savedSearchSlugParamsSchema.safeParse(request.params ?? {});
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const owner = resolveOwner(authResult.auth);
    const record = await getSavedCatalogSearchBySlug(owner, parseParams.data.slug);
    if (!record) {
      reply.status(404);
      return { error: 'saved_search_not_found' };
    }

    reply.status(200);
    return { data: serializeSavedSearch(record) };
  });

  app.patch('/saved-searches/:slug', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'catalog.saved-searches.update',
      resource: 'catalog/saved-searches',
      requiredScopes: []
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = savedSearchSlugParamsSchema.safeParse(request.params ?? {});
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseBody = savedSearchUpdateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten()
      });
      return { error: parseBody.error.flatten() };
    }

    const owner = resolveOwner(authResult.auth);
    const record = await updateSavedCatalogSearch(owner, parseParams.data.slug, toUpdateInput(parseBody.data));
    if (!record) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'not_found',
        slug: parseParams.data.slug
      });
      return { error: 'saved_search_not_found' };
    }

    reply.status(200);
    await authResult.auth.log('succeeded', {
      action: 'catalog.saved-searches.update',
      slug: record.slug
    });
    return { data: serializeSavedSearch(record) };
  });

  app.delete('/saved-searches/:slug', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'catalog.saved-searches.delete',
      resource: 'catalog/saved-searches',
      requiredScopes: []
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = savedSearchSlugParamsSchema.safeParse(request.params ?? {});
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const owner = resolveOwner(authResult.auth);
    const deleted = await deleteSavedCatalogSearch(owner, parseParams.data.slug);
    if (!deleted) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'not_found',
        slug: parseParams.data.slug
      });
      return { error: 'saved_search_not_found' };
    }

    reply.status(204);
    await authResult.auth.log('succeeded', {
      action: 'catalog.saved-searches.delete',
      slug: parseParams.data.slug
    });
    return reply;
  });

  app.post('/saved-searches/:slug/apply', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'catalog.saved-searches.apply',
      resource: 'catalog/saved-searches',
      requiredScopes: []
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = savedSearchSlugParamsSchema.safeParse(request.params ?? {});
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const owner = resolveOwner(authResult.auth);
    const record = await recordSavedCatalogSearchApplied(owner, parseParams.data.slug);
    if (!record) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'not_found',
        slug: parseParams.data.slug
      });
      return { error: 'saved_search_not_found' };
    }

    reply.status(200);
    await authResult.auth.log('succeeded', {
      action: 'catalog.saved-searches.apply',
      slug: record.slug
    });
    return { data: serializeSavedSearch(record) };
  });

  app.post('/saved-searches/:slug/share', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'catalog.saved-searches.share',
      resource: 'catalog/saved-searches',
      requiredScopes: []
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = savedSearchSlugParamsSchema.safeParse(request.params ?? {});
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const owner = resolveOwner(authResult.auth);
    const record = await recordSavedCatalogSearchShared(owner, parseParams.data.slug);
    if (!record) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'not_found',
        slug: parseParams.data.slug
      });
      return { error: 'saved_search_not_found' };
    }

    reply.status(200);
    await authResult.auth.log('succeeded', {
      action: 'catalog.saved-searches.share',
      slug: record.slug
    });
    return { data: serializeSavedSearch(record) };
  });
}
