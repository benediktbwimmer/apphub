import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket, { type SocketStream } from '@fastify/websocket';
import { Buffer } from 'node:buffer';
import { z } from 'zod';
import WebSocket, { type RawData } from 'ws';
import {
  addRepository,
  getRepositoryById,
  getIngestionHistory,
  listRepositories,
  listTagSuggestions,
  setRepositoryStatus,
  ALL_INGEST_STATUSES,
  type BuildRecord,
  type RepositoryRecord,
  type RepositoryRecordWithRelevance,
  type RepositorySearchMeta,
  type RepositorySort,
  type RelevanceWeights,
  type TagKV,
  type IngestionEvent,
  type IngestStatus,
  createLaunch,
  listBuildsForRepository,
  countBuildsForRepository,
  listLaunchesForRepository,
  getLaunchById,
  requestLaunchStop,
  type LaunchRecord,
  type LaunchEnvVar,
  getBuildById,
  createBuild,
  failLaunch
} from './db';
import {
  enqueueRepositoryIngestion,
  enqueueLaunchStart,
  enqueueLaunchStop,
  enqueueBuildJob,
  isInlineQueueMode
} from './queue';
import { runLaunchStart, runLaunchStop } from './launchRunner';
import { runBuildJob } from './buildRunner';
import { subscribeToApphubEvents, type ApphubEvent } from './events';

type SearchQuery = {
  q?: string;
  tags?: string[];
  status?: string[];
  ingestedAfter?: string;
  ingestedBefore?: string;
  sort?: RepositorySort;
  relevance?: string;
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

const launchRequestSchema = z
  .object({
    buildId: z.string().min(1).optional(),
    resourceProfile: z.string().min(1).optional(),
    env: z.array(launchEnvEntrySchema).max(32).optional()
  })
  .strict();

const launchListQuerySchema = z
  .object({
    limit: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(1).max(50).optional())
  })
  .partial();

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

function serializeRepository(record: RepositoryRecordWithRelevance) {
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
    latestBuild,
    latestLaunch,
    previewTiles
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
    latestBuild: serializeBuild(latestBuild),
    latestLaunch: serializeLaunch(latestLaunch),
    previewTiles: previewTiles.map((tile) => ({
      id: tile.id,
      kind: tile.kind,
      title: tile.title,
      description: tile.description,
      src: tile.src,
      embedUrl: tile.embedUrl,
      posterUrl: tile.posterUrl,
      width: tile.width,
      height: tile.height,
      sortOrder: tile.sortOrder,
      source: tile.source
    })),
    relevance: record.relevance ?? null
  };
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

function serializeLaunch(launch: LaunchRecord | null) {
  if (!launch) {
    return null;
  }

  return {
    id: launch.id,
    status: launch.status,
    buildId: launch.buildId,
    instanceUrl: launch.instanceUrl,
    resourceProfile: launch.resourceProfile,
    env: launch.env,
    errorMessage: launch.errorMessage,
    createdAt: launch.createdAt,
    updatedAt: launch.updatedAt,
    startedAt: launch.startedAt,
    stoppedAt: launch.stoppedAt,
    expiresAt: launch.expiresAt,
    port: launch.port
  };
}

type SerializedRepository = ReturnType<typeof serializeRepository>;
type SerializedBuild = ReturnType<typeof serializeBuild>;
type SerializedLaunch = ReturnType<typeof serializeLaunch>;

type OutboundEvent =
  | { type: 'repository.updated'; data: { repository: SerializedRepository } }
  | { type: 'repository.ingestion-event'; data: { event: IngestionEvent } }
  | { type: 'build.updated'; data: { build: SerializedBuild } }
  | { type: 'launch.updated'; data: { repositoryId: string; launch: SerializedLaunch } };

function toOutboundEvent(event: ApphubEvent): OutboundEvent | null {
  switch (event.type) {
    case 'repository.updated':
      return {
        type: 'repository.updated',
        data: { repository: serializeRepository(event.data.repository) }
      };
    case 'repository.ingestion-event':
      return {
        type: 'repository.ingestion-event',
        data: { event: event.data.event }
      };
    case 'build.updated':
      return {
        type: 'build.updated',
        data: { build: serializeBuild(event.data.build) }
      };
    case 'launch.updated':
      return {
        type: 'launch.updated',
        data: {
          repositoryId: event.data.launch.repositoryId,
          launch: serializeLaunch(event.data.launch)
        }
      };
    default:
      return null;
  }
}

async function buildServer() {
  const app = Fastify();

  await app.register(cors, {
    origin: true
  });

  await app.register(websocket, {
    options: {
      maxPayload: 1_048_576
    }
  });

  const sockets = new Set<WebSocket>();
  const broadcast = (payload: OutboundEvent) => {
    const message = JSON.stringify({ ...payload, emittedAt: new Date().toISOString() });
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
        continue;
      }
      sockets.delete(socket);
    }
  };

  const unsubscribe = subscribeToApphubEvents((event) => {
    const outbound = toOutboundEvent(event);
    if (!outbound) {
      return;
    }
    broadcast(outbound);
  });

  app.addHook('onClose', async () => {
    unsubscribe();
    for (const socket of sockets) {
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
    sockets.clear();
  });

  app.get('/ws', { websocket: true }, (connection: SocketStream) => {
    const { socket } = connection;
    sockets.add(socket);

    socket.send(
      JSON.stringify({ type: 'connection.ack', data: { now: new Date().toISOString() } })
    );

    const cleanup = () => {
      sockets.delete(socket);
    };

    socket.on('close', cleanup);
    socket.on('error', cleanup);
    socket.on('message', (data: RawData) => {
      let text: string | null = null;
      if (typeof data === 'string') {
        text = data;
      } else if (data instanceof Buffer) {
        text = data.toString('utf8');
      } else if (Array.isArray(data)) {
        text = Buffer.concat(data).toString('utf8');
      } else if (data instanceof ArrayBuffer) {
        text = Buffer.from(data).toString('utf8');
      }

      if (!text) {
        return;
      }

      if (text === 'ping') {
        socket.send(
          JSON.stringify({ type: 'pong', data: { now: new Date().toISOString() } })
        );
      }
    });
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

    const relevanceWeights = parseRelevanceWeights(query.relevance);

    const searchResult = listRepositories({
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

    const repository = getRepositoryById(parseParams.data.id);
    if (!repository) {
      reply.status(404);
      return { error: 'app not found' };
    }

    const limit = parseQuery.data?.limit ?? 10;
    const launches = listLaunchesForRepository(repository.id, limit);
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

    const repository = getRepositoryById(parseParams.data.id);
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

    const payload = parseBody.data;

    let build = payload.buildId ? getBuildById(payload.buildId) : null;
    if (payload.buildId && (!build || build.repositoryId !== repository.id)) {
      reply.status(400);
      return { error: 'build does not belong to app' };
    }

    if (!build && repository.latestBuild) {
      build = repository.latestBuild;
    }

    if (!build || build.repositoryId !== repository.id || build.status !== 'succeeded' || !build.imageTag) {
      reply.status(409);
      return { error: 'no successful build available for launch' };
    }

    const env = normalizeLaunchEnv(payload.env);

    const launch = createLaunch(repository.id, build.id, {
      resourceProfile: payload.resourceProfile ?? null,
      env
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
      failLaunch(launch.id, message.slice(0, 500));
      reply.status(502);
      const currentRepo = getRepositoryById(repository.id) ?? repository;
      const currentLaunch = getLaunchById(launch.id);
      return {
        error: message,
        data: {
          repository: serializeRepository(currentRepo),
          launch: serializeLaunch(currentLaunch ?? launch)
        }
      };
    }

    const refreshedRepo = getRepositoryById(repository.id) ?? repository;
    const refreshedLaunch = getLaunchById(launch.id) ?? launch;

    reply.status(202);
    return {
      data: {
        repository: serializeRepository(refreshedRepo),
        launch: serializeLaunch(refreshedLaunch)
      }
    };
  });

  app.post('/apps/:id/launches/:launchId/stop', async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().min(1), launchId: z.string().min(1) });
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

    const launch = getLaunchById(parseParams.data.launchId);
    if (!launch || launch.repositoryId !== repository.id) {
      reply.status(404);
      return { error: 'launch not found' };
    }

    if (!['running', 'starting', 'stopping'].includes(launch.status)) {
      reply.status(409);
      return { error: 'launch is not running' };
    }

    const pendingStop = launch.status === 'stopping' ? launch : requestLaunchStop(launch.id);
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
      failLaunch(launch.id, message.slice(0, 500));
      reply.status(502);
      const currentRepo = getRepositoryById(repository.id) ?? repository;
      const currentLaunch = getLaunchById(launch.id) ?? pendingStop;
      return {
        error: message,
        data: {
          repository: serializeRepository(currentRepo),
          launch: serializeLaunch(currentLaunch)
        }
      };
    }

    const refreshedRepo = getRepositoryById(repository.id) ?? repository;
    const refreshedLaunch = getLaunchById(launch.id) ?? pendingStop;

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
