import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ALL_INGEST_STATUSES,
  addRepository,
  countBuildsForRepository,
  createBuild,
  createLaunch,
  failLaunch,
  getBuildById,
  getIngestionHistory,
  getLaunchById,
  getRepositoryById,
  listBuildsForRepository,
  listLaunchesForRepository,
  listRepositories,
  listTagSuggestions,
  requestLaunchStop,
  setRepositoryStatus,
  type IngestStatus,
  type LaunchEnvVar,
  type RepositoryRecord,
  type RepositoryRecordWithRelevance,
  type RepositorySearchMeta,
  type RepositorySort,
  type RelevanceWeights,
  type TagKV
} from '../db/index';
import {
  enqueueBuildJob,
  enqueueLaunchStart,
  enqueueLaunchStop,
  enqueueRepositoryIngestion,
  isInlineQueueMode
} from '../queue';
import { parseEnvPort, resolveLaunchInternalPort } from '../docker';
import { buildDockerRunCommand } from '../launchCommand';
import { runLaunchStart, runLaunchStop } from '../launchRunner';
import { serializeBuild, serializeLaunch, serializeRepository } from './shared/serializers';
import type { JsonValue } from './shared/serializers';
import type { FastifyReply } from 'fastify';

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
    .optional(),
  sort: z
    .preprocess((val) => (typeof val === 'string' ? val : undefined), z.enum(['relevance', 'updated', 'name']))
    .optional(),
  relevance: z
    .preprocess((val) => (typeof val === 'string' ? val : undefined), z.string().trim())
    .optional()
});

const suggestQuerySchema = z.object({
  prefix: z
    .preprocess((val) => (typeof val === 'string' ? val : ''), z.string())
    .transform((val) => val.trim()),
  limit: z
    .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(1).max(50).default(10))
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

const launchEnvEntrySchema = z
  .object({
    key: z.string().min(1).max(128),
    value: z.string().max(4096)
  })
  .strict();

export const launchRequestSchema = z
  .object({
    buildId: z.string().min(1).optional(),
    resourceProfile: z.string().min(1).optional(),
    env: z.array(launchEnvEntrySchema).max(32).optional(),
    command: z.string().min(1).max(4000).optional(),
    launchId: z.string().min(1).max(64).optional()
  })
  .strict();

const launchListQuerySchema = z
  .object({
    limit: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(1).max(50).optional())
  })
  .partial();

const createLaunchSchema = launchRequestSchema.extend({
  repositoryId: z.string().min(1)
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

const buildTriggerSchema = z.object({
  branch: z
    .preprocess((val) => {
      if (typeof val !== 'string') {
        return undefined;
      }
      const trimmed = val.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }, z.string().min(1).max(200))
    .optional(),
  ref: z
    .preprocess((val) => {
      if (typeof val !== 'string') {
        return undefined;
      }
      const trimmed = val.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }, z.string().min(1).max(200))
    .optional()
});

const INGEST_STATUS_LOOKUP = new Set<IngestStatus>(ALL_INGEST_STATUSES);

type SearchQuery = {
  q?: string;
  tags?: string[];
  status?: string[];
  ingestedAfter?: string;
  ingestedBefore?: string;
  sort?: RepositorySort;
  relevance?: string;
};

type LaunchRequestPayload = z.infer<typeof launchRequestSchema>;

function normalizeLaunchEnv(entries?: LaunchEnvVar[]): LaunchEnvVar[] {
  if (!entries || entries.length === 0) {
    return [];
  }
  const seen = new Map<string, string>();
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }
    const key = entry.key.trim();
    if (key.length === 0) {
      continue;
    }
    const value = typeof entry.value === 'string' ? entry.value : '';
    seen.set(key, value);
    if (seen.size >= 32) {
      break;
    }
  }
  return Array.from(seen.entries()).map(([key, value]) => ({ key, value }));
}

function resolvePortFromEnvVars(entries?: LaunchEnvVar[]): number | null {
  if (!entries || entries.length === 0) {
    return null;
  }
  for (const entry of entries) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }
    const key = entry.key.trim().toLowerCase();
    if (key !== 'port') {
      continue;
    }
    const value = typeof entry.value === 'string' ? entry.value.trim() : '';
    const parsed = parseEnvPort(value);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

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
  const statuses: IngestStatus[] = [];
  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (INGEST_STATUS_LOOKUP.has(normalized as IngestStatus)) {
      statuses.push(normalized as IngestStatus);
    }
  }
  return statuses;
}

function normalizeIngestedAfter(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return new Date(parsed).toISOString();
}

function normalizeIngestedBefore(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return new Date(parsed).toISOString();
}

function parseRelevanceWeights(raw?: string): Partial<RelevanceWeights> | undefined {
  if (!raw) {
    return undefined;
  }
  const parts = raw
    .split(',')
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }
  const weights: Partial<RelevanceWeights> = {};
  for (const part of parts) {
    const [key, value] = part.split(':').map((piece) => piece.trim());
    if (!key || value === undefined) {
      continue;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    if (key === 'name' || key === 'description' || key === 'tags') {
      weights[key] = numeric;
    }
  }
  return Object.keys(weights).length > 0 ? weights : undefined;
}

async function scheduleLaunch(options: {
  repository: RepositoryRecord;
  payload: LaunchRequestPayload;
  request: FastifyRequest;
}): Promise<{ status: number; body: unknown }> {
  const { repository, payload, request } = options;

  let build = payload.buildId ? await getBuildById(payload.buildId) : null;
  if (payload.buildId && (!build || build.repositoryId !== repository.id)) {
    return { status: 400, body: { error: 'build does not belong to app' } };
  }

  if (!build && repository.latestBuild) {
    build = repository.latestBuild;
  }

  if (!build || build.repositoryId !== repository.id || build.status !== 'succeeded' || !build.imageTag) {
    return { status: 409, body: { error: 'no successful build available for launch' } };
  }

  const env = normalizeLaunchEnv(payload.env);
  const envDefinedPort = resolvePortFromEnvVars(env);
  const requestedLaunchId = typeof payload.launchId === 'string' ? payload.launchId.trim() : '';
  const launchId = requestedLaunchId.length > 0 ? requestedLaunchId : randomUUID();

  if (requestedLaunchId.length > 0) {
    const existingLaunch = await getLaunchById(launchId);
    if (existingLaunch) {
      return { status: 409, body: { error: 'launch already exists' } };
    }
  }

  const commandInput = typeof payload.command === 'string' ? payload.command.trim() : '';
  const internalPort = envDefinedPort ?? (await resolveLaunchInternalPort(build.imageTag));
  const commandFallback = buildDockerRunCommand({
    repositoryId: repository.id,
    launchId,
    imageTag: build.imageTag,
    env,
    internalPort
  }).command;
  const launchCommand = commandInput.length > 0 ? commandInput : commandFallback;

  const launch = await createLaunch(repository.id, build.id, {
    id: launchId,
    resourceProfile: payload.resourceProfile ?? null,
    env,
    command: launchCommand
  });

  try {
    if (isInlineQueueMode()) {
      await runLaunchStart(launch.id);
    } else {
      await enqueueLaunchStart(launch.id);
    }
  } catch (err) {
    const message = `Failed to schedule launch: ${(err as Error).message ?? 'unknown error'}`;
    request.log.error({ err }, 'Failed to schedule launch');
    await failLaunch(launch.id, message.slice(0, 500));
    const currentRepo = (await getRepositoryById(repository.id)) ?? repository;
    const currentLaunch = await getLaunchById(launch.id);
    return {
      status: 502,
      body: {
        error: message,
        data: {
          repository: serializeRepository(currentRepo),
          launch: serializeLaunch(currentLaunch ?? launch)
        }
      }
    };
  }

  const refreshedRepo = (await getRepositoryById(repository.id)) ?? repository;
  const refreshedLaunch = (await getLaunchById(launch.id)) ?? launch;

  return {
    status: 202,
    body: {
      data: {
        repository: serializeRepository(refreshedRepo),
        launch: serializeLaunch(refreshedLaunch)
      }
    }
  };
}

export async function registerRepositoryRoutes(app: FastifyInstance): Promise<void> {
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

    const relevanceWeights = parseRelevanceWeights(query.relevance);

    const searchResult = await listRepositories({
      text: query.q,
      tags,
      statuses: statuses.length > 0 ? statuses : undefined,
      ingestedAfter,
      ingestedBefore,
      sort: query.sort,
      relevanceWeights
    });

    return {
      data: searchResult.records.map(serializeRepository),
      facets: searchResult.facets,
      total: searchResult.total,
      meta: searchResult.meta satisfies RepositorySearchMeta
    };
  });

  app.get('/apps/:id', async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().min(1) });
    const parseResult = paramsSchema.safeParse(request.params);
    if (!parseResult.success) {
      reply.status(400);
      return { error: parseResult.error.flatten() };
    }

    const repository = await getRepositoryById(parseResult.data.id);
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

    const repository = await getRepositoryById(parseParams.data.id);
    if (!repository) {
      reply.status(404);
      return { error: 'app not found' };
    }

    const history = await getIngestionHistory(repository.id);
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

    const repository = await getRepositoryById(parseParams.data.id);
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
    const builds = await listBuildsForRepository(repository.id, { limit, offset });
    const total = await countBuildsForRepository(repository.id);
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

  app.post('/apps/:id/builds', async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().min(1) });
    const parseParams = paramsSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const repository = await getRepositoryById(parseParams.data.id);
    if (!repository) {
      reply.status(404);
      return { error: 'app not found' };
    }

    const parseBody = buildTriggerSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const branch = parseBody.data.branch ?? null;
    const gitRef = parseBody.data.ref ?? null;

    const newBuild = await createBuild(repository.id, {
      gitBranch: branch,
      gitRef
    });

    try {
      await enqueueBuildJob(newBuild.id, repository.id);
    } catch (err) {
      request.log.error({ err }, 'Failed to enqueue build');
      reply.status(502);
      const message = `Failed to enqueue build: ${(err as Error).message ?? 'unknown error'}`;
      return { error: message, data: serializeBuild(newBuild) };
    }

    const persisted = (await getBuildById(newBuild.id)) ?? newBuild;

    reply.status(202);
    return { data: serializeBuild(persisted) };
  });

  app.get('/apps/:id/launches', async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().min(1) });
    const parseParams = paramsSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = launchListQuerySchema.safeParse(request.query);
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const repository = await getRepositoryById(parseParams.data.id);
    if (!repository) {
      reply.status(404);
      return { error: 'app not found' };
    }

    const limit = parseQuery.data?.limit ?? 10;
    const launches = await listLaunchesForRepository(repository.id, limit);
    return {
      data: launches.map(serializeLaunch)
    };
  });

  app.post('/apps/:id/launch', async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().min(1) });
    const parseParams = paramsSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const repository = await getRepositoryById(parseParams.data.id);
    if (!repository) {
      reply.status(404);
      return { error: 'app not found' };
    }

    const body = (request.body as unknown) ?? {};
    const parseBody = launchRequestSchema.safeParse(body);
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const result = await scheduleLaunch({
      repository,
      payload: parseBody.data,
      request
    });

    reply.status(result.status);
    return result.body;
  });

  app.post('/launches', async (request, reply) => {
    const body = (request.body as unknown) ?? {};
    const parseBody = createLaunchSchema.safeParse(body);
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const { repositoryId, ...rest } = parseBody.data;
    const repository = await getRepositoryById(repositoryId);
    if (!repository) {
      reply.status(404);
      return { error: 'app not found' };
    }

    const result = await scheduleLaunch({
      repository,
      payload: rest as LaunchRequestPayload,
      request
    });

    reply.status(result.status);
    return result.body;
  });

  app.post('/apps/:id/launches/:launchId/stop', async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().min(1), launchId: z.string().min(1) });
    const parseParams = paramsSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const repository = await getRepositoryById(parseParams.data.id);
    if (!repository) {
      reply.status(404);
      return { error: 'app not found' };
    }

    const launch = await getLaunchById(parseParams.data.launchId);
    if (!launch || launch.repositoryId !== repository.id) {
      reply.status(404);
      return { error: 'launch not found' };
    }

    if (!['running', 'starting', 'stopping'].includes(launch.status)) {
      reply.status(409);
      return { error: 'launch is not running' };
    }

    const pendingStop =
      launch.status === 'stopping' ? launch : await requestLaunchStop(launch.id);
    if (!pendingStop) {
      reply.status(409);
      return { error: 'launch is not running' };
    }

    try {
      if (isInlineQueueMode()) {
        await runLaunchStop(launch.id);
      } else {
        await enqueueLaunchStop(launch.id);
      }
    } catch (err) {
      const message = `Failed to schedule stop: ${(err as Error).message ?? 'unknown error'}`;
      request.log.error({ err }, 'Failed to schedule launch stop');
      await failLaunch(launch.id, message.slice(0, 500));
      reply.status(502);
      const currentRepo = (await getRepositoryById(repository.id)) ?? repository;
      const currentLaunch = (await getLaunchById(launch.id)) ?? pendingStop;
      return {
        error: message,
        data: {
          repository: serializeRepository(currentRepo),
          launch: serializeLaunch(currentLaunch)
        }
      };
    }

    const refreshedRepo = (await getRepositoryById(repository.id)) ?? repository;
    const refreshedLaunch = (await getLaunchById(launch.id)) ?? pendingStop;

    reply.status(202);
    return {
      data: {
        repository: serializeRepository(refreshedRepo),
        launch: serializeLaunch(refreshedLaunch)
      }
    };
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

    const build = await getBuildById(parseParams.data.id);
    if (!build) {
      reply.status(404);
      return { error: 'build not found' };
    }

    const logs = build.logs ?? '';
    if (parseQuery.data.download) {
      reply.header('Content-Type', 'text/plain; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="build-${build.id}.log"`);
      reply.status(200);
      return logs;
    }

    const previewLimit = 4000;
    const preview = logs.length > previewLimit ? logs.slice(-previewLimit) : logs;
    reply.status(200);
    return {
      data: {
        id: build.id,
        repositoryId: build.repositoryId,
        status: build.status,
        logs,
        logsPreview: preview,
        hasLogs: Boolean(logs && logs.length > 0),
        logsTruncated: preview.length < logs.length,
        logsSize: Buffer.byteLength(logs, 'utf8')
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

    const existing = await getBuildById(parseParams.data.id);
    if (!existing) {
      reply.status(404);
      return { error: 'build not found' };
    }

    const repository = await getRepositoryById(existing.repositoryId);
    if (!repository) {
      reply.status(404);
      return { error: 'app not found' };
    }

    const newBuild = await createBuild(repository.id, {
      commitSha: existing.commitSha,
      gitBranch: existing.gitBranch,
      gitRef: existing.gitRef
    });

    try {
      await enqueueBuildJob(newBuild.id, repository.id);
    } catch (err) {
      request.log.error({ err }, 'Failed to enqueue build retry');
      reply.status(502);
      const message = `Failed to enqueue build retry: ${(err as Error).message ?? 'unknown error'}`;
      return { error: message, data: serializeBuild(newBuild) };
    }

    const persisted = (await getBuildById(newBuild.id)) ?? newBuild;

    reply.status(202);
    return { data: serializeBuild(persisted) };
  });

  app.get('/tags/suggest', async (request, reply) => {
    const parseResult = suggestQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      reply.status(400);
      return { error: parseResult.error.flatten() };
    }

    const { prefix, limit } = parseResult.data;
    const suggestions = await listTagSuggestions(prefix, limit);

    return { data: suggestions };
  });

  app.post('/apps', async (request, reply) => {
    const parseResult = createRepositorySchema.safeParse(request.body);
    if (!parseResult.success) {
      reply.status(400);
      return { error: parseResult.error.flatten() };
    }

    const payload = parseResult.data;

    let repository = await addRepository({
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
      await setRepositoryStatus(repository.id, 'failed', {
        updatedAt: now,
        ingestError: message.slice(0, 500),
        eventMessage: message
      });
      repository = (await getRepositoryById(repository.id)) ?? repository;
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

    const repository = await getRepositoryById(parseParams.data.id);
    if (!repository) {
      reply.status(404);
      return { error: 'app not found' };
    }

    if (repository.ingestStatus === 'processing' || repository.ingestStatus === 'pending') {
      reply.status(409);
      return { error: 'ingestion already in progress' };
    }

    const now = new Date().toISOString();
    await setRepositoryStatus(repository.id, 'pending', {
      updatedAt: now,
      ingestError: null,
      eventMessage: 'Re-queued for ingestion'
    });

    try {
      await enqueueRepositoryIngestion(repository.id);
    } catch (err) {
      request.log.error({ err }, 'Failed to enqueue retry');
      const message = `Failed to enqueue retry: ${(err as Error).message ?? 'unknown error'}`;
      await setRepositoryStatus(repository.id, 'failed', {
        updatedAt: new Date().toISOString(),
        ingestError: message.slice(0, 500),
        eventMessage: message
      });
      reply.status(502);
      const current = await getRepositoryById(repository.id);
      return { error: message, data: current ? serializeRepository(current) : undefined };
    }

    const refreshed = await getRepositoryById(repository.id);

    reply.status(202);
    return { data: refreshed ? serializeRepository(refreshed) : null };
  });
}
