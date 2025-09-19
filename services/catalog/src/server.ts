import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import {
  addRepository,
  getRepositoryById,
  getIngestionHistory,
  listRepositories,
  listTagSuggestions,
  setRepositoryStatus,
  listBuildsForRepository,
  countBuildsForRepository,
  getBuildById,
  createBuild,
  ALL_INGEST_STATUSES,
  type BuildRecord,
  type RepositoryRecord,
  type TagKV,
  type IngestStatus
} from './db';
import { enqueueRepositoryIngestion, enqueueBuildJob, isInlineQueueMode } from './queue';
import { runBuildJob } from './buildRunner';

type SearchQuery = {
  q?: string;
  tags?: string[];
  status?: string[];
  ingestedAfter?: string;
  ingestedBefore?: string;
};

const tagQuerySchema = z
  .string()
  .trim()
  .transform((raw) =>
    raw
      .split(/[\s,]+/)
      .map((token) => token.trim())
      .filter(Boolean)
  );

const statusQuerySchema = z
  .string()
  .trim()
  .transform((raw) =>
    raw
      .split(/[\s,]+/)
      .map((token) => token.trim())
      .filter(Boolean)
  );

const isoDateSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid date');

const INGEST_STATUS_LOOKUP = new Set<IngestStatus>(ALL_INGEST_STATUSES);

const searchQuerySchema = z.object({
  q: z.string().trim().optional(),
  tags: z
    .preprocess((val) => (typeof val === 'string' ? val : undefined), tagQuerySchema)
    .optional(),
  status: z
    .preprocess((val) => (typeof val === 'string' ? val : undefined), statusQuerySchema)
    .optional(),
  ingestedAfter: z
    .preprocess((val) => (typeof val === 'string' ? val : undefined), isoDateSchema)
    .optional(),
  ingestedBefore: z
    .preprocess((val) => (typeof val === 'string' ? val : undefined), isoDateSchema)
    .optional()
});

const suggestQuerySchema = z.object({
  prefix: z
    .preprocess((val) => (typeof val === 'string' ? val : ''), z.string())
    .transform((val) => val.trim()),
  limit: z
    .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(1).max(50).default(10))
});

const buildListQuerySchema = z.object({
  limit: z
    .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(1).max(100).default(10)),
  offset: z
    .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(0).default(0))
});

const buildLogsQuerySchema = z.object({
  download: z
    .preprocess((val) => {
      if (typeof val === 'string') {
        return val === '1' || val.toLowerCase() === 'true';
      }
      if (typeof val === 'boolean') {
        return val;
      }
      return false;
    }, z.boolean())
    .default(false)
});

const createRepositorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  repoUrl: z
    .string()
    .min(1)
    .refine((value) => {
      try {
        const url = new URL(value);
        if (url.protocol === 'file:') {
          return true;
        }
        return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'git:';
      } catch (err) {
        return value.startsWith('/');
      }
    }, 'repoUrl must be an absolute path or a valid URL'),
  dockerfilePath: z.string().min(1),
  tags: z
    .array(
      z.object({
        key: z.string().min(1),
        value: z.string().min(1)
      })
    )
    .default([])
});

function toTagFilters(tokens: string[] = []): TagKV[] {
  const filters: TagKV[] = [];
  for (const token of tokens) {
    const [key, value] = token.split(':');
    if (!key || !value) {
      continue;
    }
    filters.push({ key, value });
  }
  return filters;
}

function toIngestStatuses(tokens: string[] = []): IngestStatus[] {
  const normalized = new Set<IngestStatus>();
  for (const token of tokens) {
    const lower = token.toLowerCase() as IngestStatus;
    if (INGEST_STATUS_LOOKUP.has(lower)) {
      normalized.add(lower);
    }
  }
  return Array.from(normalized);
}

function normalizeIngestedAfter(raw?: string) {
  if (!raw) {
    return undefined;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

function normalizeIngestedBefore(raw?: string) {
  if (!raw) {
    return undefined;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  date.setUTCHours(23, 59, 59, 999);
  return date.toISOString();
}

function serializeRepository(record: RepositoryRecord) {
  const {
    id,
    name,
    description,
    repoUrl,
    dockerfilePath,
    updatedAt,
    tags,
    ingestStatus,
    ingestError,
    ingestAttempts,
    latestBuild
  } = record;
  return {
    id,
    name,
    description,
    repoUrl,
    dockerfilePath,
    updatedAt,
    tags: tags.map((tag) => ({ key: tag.key, value: tag.value })),
    ingestStatus,
    ingestError,
    ingestAttempts,
    latestBuild: serializeBuild(latestBuild)
  };
}

const LOG_PREVIEW_LIMIT = 4000;

function serializeBuild(build: BuildRecord | null) {
  if (!build) {
    return null;
  }

  const logs = build.logs ?? null;
  const preview = logs
    ? logs.length > LOG_PREVIEW_LIMIT
      ? logs.slice(-LOG_PREVIEW_LIMIT)
      : logs
    : null;
  const truncated = Boolean(logs && preview && preview.length < logs.length);

  return {
    id: build.id,
    repositoryId: build.repositoryId,
    status: build.status,
    imageTag: build.imageTag,
    errorMessage: build.errorMessage,
    commitSha: build.commitSha,
    createdAt: build.createdAt,
    updatedAt: build.updatedAt,
    startedAt: build.startedAt,
    completedAt: build.completedAt,
    durationMs: build.durationMs,
    logsPreview: preview,
    logsTruncated: truncated,
    hasLogs: Boolean(logs && logs.length > 0),
    logsSize: logs ? Buffer.byteLength(logs, 'utf8') : 0
  };
}

async function buildServer() {
  const app = Fastify();

  await app.register(cors, {
    origin: true
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/apps', async (request, reply) => {
    const parseResult = searchQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      reply.status(400);
      return { error: parseResult.error.flatten() };
    }

    const query = parseResult.data as SearchQuery;
    const tags = toTagFilters(query.tags ?? []);
    const statuses = toIngestStatuses(query.status ?? []);
    const ingestedAfter = normalizeIngestedAfter(query.ingestedAfter);
    let ingestedBefore = normalizeIngestedBefore(query.ingestedBefore);

    if (ingestedAfter && ingestedBefore) {
      const afterTime = Date.parse(ingestedAfter);
      const beforeTime = Date.parse(ingestedBefore);
      if (Number.isFinite(afterTime) && Number.isFinite(beforeTime) && beforeTime < afterTime) {
        ingestedBefore = ingestedAfter;
      }
    }

    const searchResult = listRepositories({
      text: query.q,
      tags,
      statuses: statuses.length > 0 ? statuses : undefined,
      ingestedAfter,
      ingestedBefore
    });

    return {
      data: searchResult.records.map(serializeRepository),
      facets: searchResult.facets,
      total: searchResult.total
    };
  });

  app.get('/apps/:id', async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().min(1) });
    const parseResult = paramsSchema.safeParse(request.params);
    if (!parseResult.success) {
      reply.status(400);
      return { error: parseResult.error.flatten() };
    }

    const repository = getRepositoryById(parseResult.data.id);
    if (!repository) {
      reply.status(404);
      return { error: 'app not found' };
    }

    return {
      data: serializeRepository(repository)
    };
  });

  app.get('/apps/:id/history', async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().min(1) });
    const parseParams = paramsSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const repository = getRepositoryById(parseParams.data.id);
    if (!repository) {
      reply.status(404);
      return { error: 'app not found' };
    }

    const history = getIngestionHistory(repository.id);
    return {
      data: history
    };
  });

  app.get('/apps/:id/builds', async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().min(1) });
    const parseParams = paramsSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const repository = getRepositoryById(parseParams.data.id);
    if (!repository) {
      reply.status(404);
      return { error: 'app not found' };
    }

    const parseQuery = buildListQuerySchema.safeParse(request.query);
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const { limit, offset } = parseQuery.data;
    const builds = listBuildsForRepository(repository.id, { limit, offset });
    const total = countBuildsForRepository(repository.id);
    const nextOffset = offset + builds.length;
    const hasMore = nextOffset < total;

    return {
      data: builds.map(serializeBuild),
      meta: {
        total,
        count: builds.length,
        limit,
        offset,
        nextOffset: hasMore ? nextOffset : null,
        hasMore
      }
    };
  });

  app.get('/tags/suggest', async (request, reply) => {
    const parseResult = suggestQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      reply.status(400);
      return { error: parseResult.error.flatten() };
    }

    const { prefix, limit } = parseResult.data;
    const suggestions = listTagSuggestions(prefix, limit);

    return { data: suggestions };
  });

  app.post('/apps', async (request, reply) => {
    const parseResult = createRepositorySchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400);
      return { error: parseResult.error.flatten() };
    }

    const payload = parseResult.data;

    let repository = addRepository({
      id: payload.id,
      name: payload.name,
      description: payload.description,
      repoUrl: payload.repoUrl,
      dockerfilePath: payload.dockerfilePath,
      tags: payload.tags.map((tag) => ({ ...tag, source: 'author' })),
      ingestStatus: 'pending'
    });

    try {
      await enqueueRepositoryIngestion(repository.id);
    } catch (err) {
      request.log.error({ err }, 'Failed to enqueue ingestion job');
      const message = `Failed to enqueue ingestion job: ${(err as Error).message ?? 'unknown error'}`;
      const now = new Date().toISOString();
      setRepositoryStatus(repository.id, 'failed', {
        updatedAt: now,
        ingestError: message.slice(0, 500),
        eventMessage: message
      });
      repository = getRepositoryById(repository.id) ?? repository;
    }

    reply.status(201);
    return { data: serializeRepository(repository) };
  });

  app.post('/apps/:id/retry', async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().min(1) });
    const parseParams = paramsSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const repository = getRepositoryById(parseParams.data.id);
    if (!repository) {
      reply.status(404);
      return { error: 'app not found' };
    }

    if (repository.ingestStatus === 'processing' || repository.ingestStatus === 'pending') {
      reply.status(409);
      return { error: 'ingestion already in progress' };
    }

    const now = new Date().toISOString();
    setRepositoryStatus(repository.id, 'pending', {
      updatedAt: now,
      ingestError: null,
      eventMessage: 'Re-queued for ingestion'
    });

    try {
      await enqueueRepositoryIngestion(repository.id);
    } catch (err) {
      request.log.error({ err }, 'Failed to enqueue retry');
      const message = `Failed to enqueue retry: ${(err as Error).message ?? 'unknown error'}`;
      setRepositoryStatus(repository.id, 'failed', {
        updatedAt: new Date().toISOString(),
        ingestError: message.slice(0, 500),
        eventMessage: message
      });
      reply.status(502);
      const current = getRepositoryById(repository.id);
      return { error: message, data: current ? serializeRepository(current) : undefined };
    }

    const refreshed = getRepositoryById(repository.id);

    reply.status(202);
    return { data: refreshed ? serializeRepository(refreshed) : null };
  });

  app.get('/builds/:id/logs', async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().min(1) });
    const parseParams = paramsSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = buildLogsQuerySchema.safeParse(request.query);
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const build = getBuildById(parseParams.data.id);
    if (!build) {
      reply.status(404);
      return { error: 'build not found' };
    }

    const logs = build.logs ?? '';
    const size = Buffer.byteLength(logs, 'utf8');

    if (parseQuery.data.download) {
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      reply.header('Cache-Control', 'no-store');
      reply.header('Content-Disposition', `attachment; filename="${build.id}.log"`);
      return logs;
    }

    return {
      data: {
        id: build.id,
        repositoryId: build.repositoryId,
        logs,
        size,
        updatedAt: build.updatedAt
      }
    };
  });

  app.post('/builds/:id/retry', async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().min(1) });
    const parseParams = paramsSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const existing = getBuildById(parseParams.data.id);
    if (!existing) {
      reply.status(404);
      return { error: 'build not found' };
    }

    if (existing.status !== 'failed') {
      reply.status(409);
      return { error: 'only failed builds can be retried' };
    }

    const repository = getRepositoryById(existing.repositoryId);
    if (!repository) {
      reply.status(404);
      return { error: 'repository missing for build' };
    }

    const newBuild = createBuild(repository.id, { commitSha: existing.commitSha });

    try {
      if (isInlineQueueMode()) {
        await runBuildJob(newBuild.id);
      } else {
        await enqueueBuildJob(newBuild.id, repository.id);
      }
    } catch (err) {
      request.log.error({ err }, 'Failed to enqueue build retry');
      reply.status(502);
      const message = `Failed to enqueue build retry: ${(err as Error).message ?? 'unknown error'}`;
      return { error: message, data: serializeBuild(newBuild) };
    }

    const persisted = getBuildById(newBuild.id) ?? newBuild;

    reply.status(202);
    return { data: serializeBuild(persisted) };
  });

  return app;
}

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

buildServer()
  .then((app) => {
    app
      .listen({ port, host })
      .then(() => {
        app.log.info(`Catalog API listening on http://${host}:${port}`);
      })
      .catch((err) => {
        app.log.error(err);
        process.exit(1);
      });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
