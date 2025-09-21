import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import websocket, { type SocketStream } from '@fastify/websocket';
import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
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
  failLaunch,
  listServices,
  getServiceBySlug,
  upsertService,
  setServiceStatus,
  nukeCatalogDatabase,
  type ServiceRecord,
  type ServiceStatusUpdate,
  type ServiceUpsertInput,
  type JsonValue,
  listJobDefinitions,
  createJobDefinition,
  getJobDefinitionBySlug,
  listJobRunsForDefinition,
  createJobRun,
  getJobRunById,
  completeJobRun,
  getJobBundleVersion,
  listWorkflowDefinitions,
  createWorkflowDefinition,
  updateWorkflowDefinition,
  getWorkflowDefinitionBySlug,
  createWorkflowRun,
  listWorkflowRunsForDefinition,
  getWorkflowRunById,
  updateWorkflowRun,
  listWorkflowRunSteps,
  type JobDefinitionRecord,
  type JobRunRecord,
  type JobBundleRecord,
  type JobBundleVersionRecord,
  type WorkflowDefinitionRecord,
  type WorkflowRunRecord,
  type WorkflowRunStepRecord
} from './db/index';
import {
  enqueueRepositoryIngestion,
  enqueueLaunchStart,
  enqueueLaunchStop,
  enqueueBuildJob,
  enqueueWorkflowRun,
  isInlineQueueMode
} from './queue';
import { authorizeOperatorAction, type OperatorScope } from './auth/tokens';
import { computeRunMetrics } from './observability/metrics';
import { parseEnvPort, resolveLaunchInternalPort } from './docker';
import { runLaunchStart, runLaunchStop } from './launchRunner';
import { executeJobRun } from './jobs/runtime';
import {
  publishBundleVersion,
  getBundle,
  getBundleWithVersions,
  getBundleVersionWithDownload,
  listBundles as listJobBundles,
  updateBundleVersion as updateJobBundleVersionRecord
} from './jobs/registryService';
import {
  verifyLocalBundleDownload,
  openLocalBundleArtifact,
  ensureLocalBundleExists,
  type BundleDownloadInfo
} from './jobs/bundleStorage';
import { subscribeToApphubEvents, type ApphubEvent } from './events';
import { buildDockerRunCommand } from './launchCommand';
import { initializeServiceRegistry } from './serviceRegistry';
import {
  appendServiceConfigImport,
  clearServiceConfigImports,
  previewServiceConfigImport,
  resolveServiceConfigPaths,
  DEFAULT_SERVICE_CONFIG_PATH,
  DuplicateModuleImportError
} from './serviceConfigLoader';

type SearchQuery = {
  q?: string;
  tags?: string[];
  status?: string[];
  ingestedAfter?: string;
  ingestedBefore?: string;
  sort?: RepositorySort;
  relevance?: string;
};

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(jsonValueSchema)])
);

const jsonObjectSchema = z.record(jsonValueSchema);

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

const JOB_WRITE_SCOPES: OperatorScope[] = ['jobs:write'];
const JOB_RUN_SCOPES: OperatorScope[] = ['jobs:run'];
const WORKFLOW_WRITE_SCOPES: OperatorScope[] = ['workflows:write'];
const WORKFLOW_RUN_SCOPES: OperatorScope[] = ['workflows:run'];
const JOB_BUNDLE_WRITE_SCOPES: OperatorScope[] = ['job-bundles:write'];
const MAX_BUNDLE_ARTIFACT_BYTES = Number(process.env.APPHUB_JOB_BUNDLE_MAX_SIZE ?? 16 * 1024 * 1024);

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

const jobRetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(10).optional(),
    strategy: z.enum(['none', 'fixed', 'exponential']).optional(),
    initialDelayMs: z.number().int().min(0).max(86_400_000).optional(),
    maxDelayMs: z.number().int().min(0).max(86_400_000).optional(),
    jitter: z.enum(['none', 'full', 'equal']).optional()
  })
  .strict();

const jobDefinitionCreateSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'Slug must contain only alphanumeric characters, dashes, or underscores'),
    name: z.string().min(1),
    version: z.number().int().min(1).optional(),
    type: z.enum(['batch', 'service-triggered', 'manual']),
    entryPoint: z.string().min(1),
    timeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
    retryPolicy: jobRetryPolicySchema.optional(),
    parametersSchema: jsonObjectSchema.optional(),
    defaultParameters: jsonObjectSchema.optional(),
    metadata: jsonValueSchema.optional()
  })
  .strict();

const jobRunRequestSchema = z
  .object({
    parameters: jsonValueSchema.optional(),
    timeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
    context: jsonValueSchema.optional()
  })
  .strict();

const jobRunListQuerySchema = z
  .object({
    limit: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(1).max(50).optional()),
    offset: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(0).optional())
  })
  .partial();

const jobBundleManifestSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    entry: z.string().min(1),
    description: z.string().optional(),
    capabilities: z.array(z.string().min(1)).optional(),
    metadata: jsonValueSchema.optional()
  })
  .passthrough();

const jobBundleArtifactSchema = z
  .object({
    data: z.string().min(1),
    filename: z.string().min(1).max(256).optional(),
    contentType: z.string().min(1).max(256).optional(),
    checksum: z.string().min(32).max(128).optional()
  })
  .strict();

const jobBundlePublishSchema = z
  .object({
    slug: z.string().min(1).max(100),
    version: z.string().min(1).max(100),
    manifest: jobBundleManifestSchema,
    capabilityFlags: z.array(z.string().min(1)).optional(),
    immutable: z.boolean().optional(),
    metadata: jsonValueSchema.optional(),
    description: z.string().optional(),
    displayName: z.string().optional(),
    artifact: jobBundleArtifactSchema
  })
  .strict();

const jobBundleUpdateSchema = z
  .object({
    deprecated: z.boolean().optional(),
    metadata: jsonValueSchema.nullable().optional()
  })
  .refine((payload) => payload.deprecated !== undefined || payload.metadata !== undefined, {
    message: 'At least one field must be provided'
  });

const workflowTriggerSchema = z
  .object({
    type: z.string().min(1),
    options: jsonValueSchema.optional()
  })
  .strict();

const secretReferenceSchema = z.union([
  z
    .object({
      source: z.literal('env'),
      key: z.string().min(1)
    })
    .strict(),
  z
    .object({
      source: z.literal('store'),
      key: z.string().min(1),
      version: z.string().min(1).optional()
    })
    .strict()
]);

const serviceHeaderValueSchema = z.union([
  z.string().min(1),
  z
    .object({
      secret: secretReferenceSchema,
      prefix: z.string().min(1).optional()
    })
    .strict()
]);

const workflowServiceRequestSchema = z
  .object({
    path: z.string().min(1),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).optional(),
    headers: z.record(serviceHeaderValueSchema).optional(),
    query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
    body: jsonValueSchema.nullable().optional()
  })
  .strict();

const workflowJobStepSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.literal('job').optional(),
    jobSlug: z.string().min(1),
    description: z.string().min(1).optional(),
    dependsOn: z.array(z.string().min(1)).max(25).optional(),
    parameters: jsonValueSchema.optional(),
    timeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
    retryPolicy: jobRetryPolicySchema.optional(),
    storeResultAs: z.string().min(1).max(200).optional()
  })
  .strict();

const workflowServiceStepSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.literal('service'),
    serviceSlug: z.string().min(1),
    description: z.string().min(1).optional(),
    dependsOn: z.array(z.string().min(1)).max(25).optional(),
    parameters: jsonValueSchema.optional(),
    timeoutMs: z.number().int().min(1000).max(86_400_000).optional(),
    retryPolicy: jobRetryPolicySchema.optional(),
    requireHealthy: z.boolean().optional(),
    allowDegraded: z.boolean().optional(),
    captureResponse: z.boolean().optional(),
    storeResponseAs: z.string().min(1).max(200).optional(),
    request: workflowServiceRequestSchema
  })
  .strict();

const workflowStepSchema = z.union([workflowJobStepSchema, workflowServiceStepSchema]);

const workflowDefinitionCreateSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'Slug must contain only alphanumeric characters, dashes, or underscores'),
    name: z.string().min(1),
    version: z.number().int().min(1).optional(),
    description: z.string().min(1).optional(),
    steps: z.array(workflowStepSchema).min(1).max(100),
    triggers: z.array(workflowTriggerSchema).optional(),
    parametersSchema: jsonObjectSchema.optional(),
    defaultParameters: jsonValueSchema.optional(),
    metadata: jsonValueSchema.optional()
  })
  .strict();

const workflowDefinitionUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    version: z.number().int().min(1).optional(),
    description: z.string().min(1).nullable().optional(),
    steps: z.array(workflowStepSchema).min(1).max(100).optional(),
    triggers: z.array(workflowTriggerSchema).optional(),
    parametersSchema: jsonObjectSchema.optional(),
    defaultParameters: jsonValueSchema.optional(),
    metadata: jsonValueSchema.nullable().optional()
  })
  .strict()
  .refine((payload) => Object.keys(payload).length > 0, {
    message: 'At least one field must be provided'
  });

type WorkflowStepInput = z.infer<typeof workflowStepSchema>;
type WorkflowTriggerInput = z.infer<typeof workflowTriggerSchema>;

function normalizeWorkflowDependsOn(dependsOn?: string[]) {
  if (!dependsOn) {
    return undefined;
  }
  const unique = Array.from(new Set(dependsOn.map((id) => id.trim()).filter(Boolean)));
  return unique.length > 0 ? unique : undefined;
}

function normalizeWorkflowSteps(steps: WorkflowStepInput[]) {
  return steps.map((step) => {
    const base = {
      id: step.id,
      name: step.name,
      description: step.description ?? null,
      dependsOn: normalizeWorkflowDependsOn(step.dependsOn)
    };

    if (step.type === 'service') {
      return {
        ...base,
        type: 'service' as const,
        serviceSlug: step.serviceSlug.trim().toLowerCase(),
        parameters: step.parameters ?? undefined,
        timeoutMs: step.timeoutMs ?? null,
        retryPolicy: step.retryPolicy ?? null,
        requireHealthy: step.requireHealthy ?? undefined,
        allowDegraded: step.allowDegraded ?? undefined,
        captureResponse: step.captureResponse ?? undefined,
        storeResponseAs: step.storeResponseAs ?? undefined,
        request: step.request
      };
    }

    return {
      ...base,
      type: 'job' as const,
      jobSlug: step.jobSlug,
      parameters: step.parameters ?? undefined,
      timeoutMs: step.timeoutMs ?? null,
      retryPolicy: step.retryPolicy ?? null,
      storeResultAs: step.storeResultAs ?? undefined
    };
  });
}

function normalizeWorkflowTriggers(triggers?: WorkflowTriggerInput[]) {
  if (!triggers) {
    return undefined;
  }
  return triggers.map((trigger) => ({
    type: trigger.type,
    options: trigger.options ?? null
  }));
}

const workflowRunRequestSchema = z
  .object({
    parameters: jsonValueSchema.optional(),
    triggeredBy: z.string().min(1).max(200).optional(),
    trigger: workflowTriggerSchema.optional()
  })
  .strict();

const workflowRunListQuerySchema = z
  .object({
    limit: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(1).max(50).optional()),
    offset: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(0).optional())
  })
  .partial();

const workflowSlugParamSchema = z
  .object({
    slug: z.string().min(1)
  })
  .strict();

const workflowRunIdParamSchema = z
  .object({
    runId: z.string().min(1)
  })
  .strict();

const buildListQuerySchema = z.object({
  limit: z
    .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(1).max(100).default(10)),
  offset: z
    .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(0).default(0))
});

const serviceStatusSchema = z.enum(['unknown', 'healthy', 'degraded', 'unreachable']);

const serviceRegistrationSchema = z
  .object({
    slug: z.string().min(1),
    displayName: z.string().min(1),
    kind: z.string().min(1),
    baseUrl: z.string().min(1).url(),
    status: serviceStatusSchema.optional(),
    statusMessage: z.string().nullable().optional(),
    capabilities: jsonValueSchema.optional(),
    metadata: jsonValueSchema.optional()
  })
  .strict();

const servicePatchSchema = z
  .object({
    baseUrl: z.string().min(1).url().optional(),
    status: serviceStatusSchema.optional(),
    statusMessage: z.string().nullable().optional(),
    capabilities: jsonValueSchema.optional(),
    metadata: jsonValueSchema.optional(),
    lastHealthyAt: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid ISO timestamp')
      .nullable()
      .optional()
  })
  .strict();

const gitShaSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{7,40}$/i, 'commit must be a git SHA');

const serviceConfigImportSchema = z
  .object({
    repo: z.string().min(1),
    ref: z.string().min(1).optional(),
    commit: gitShaSchema.optional(),
    configPath: z.string().min(1).optional(),
    module: z.string().min(1).optional()
  })
  .strict();

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

type LaunchRequestPayload = z.infer<typeof launchRequestSchema>;

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
    launchEnvTemplates: record.launchEnvTemplates,
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
    gitBranch: build.gitBranch,
    gitRef: build.gitRef,
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
    command: launch.command,
    errorMessage: launch.errorMessage,
    createdAt: launch.createdAt,
    updatedAt: launch.updatedAt,
    startedAt: launch.startedAt,
    stoppedAt: launch.stoppedAt,
    expiresAt: launch.expiresAt,
    port: launch.port,
    internalPort: launch.internalPort,
    containerIp: launch.containerIp
  };
}

function extractOpenApiMetadata(metadata: JsonValue | null): JsonValue | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const metadataObject = metadata as Record<string, JsonValue>;
  const openapi = metadataObject.openapi;
  if (!openapi || typeof openapi !== 'object' || Array.isArray(openapi)) {
    return null;
  }
  return openapi;
}

function serializeService(service: ServiceRecord) {
  return {
    id: service.id,
    slug: service.slug,
    displayName: service.displayName,
    kind: service.kind,
    baseUrl: service.baseUrl,
    status: service.status,
    statusMessage: service.statusMessage,
    capabilities: service.capabilities,
    metadata: service.metadata,
    openapi: extractOpenApiMetadata(service.metadata),
    lastHealthyAt: service.lastHealthyAt,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt
  };
}

function serializeJobDefinition(job: JobDefinitionRecord) {
  let registryRef: string | null = null;
  if (job.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata)) {
    const candidate = (job.metadata as Record<string, JsonValue | undefined>).registryRef;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      registryRef = candidate.trim();
    }
  }
  return {
    id: job.id,
    slug: job.slug,
    name: job.name,
    version: job.version,
    type: job.type,
    entryPoint: job.entryPoint,
    registryRef,
    parametersSchema: job.parametersSchema,
    defaultParameters: job.defaultParameters,
    timeoutMs: job.timeoutMs,
    retryPolicy: job.retryPolicy,
    metadata: job.metadata,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function serializeJobRun(run: JobRunRecord) {
  return {
    id: run.id,
    jobDefinitionId: run.jobDefinitionId,
    status: run.status,
    parameters: run.parameters,
    result: run.result,
    errorMessage: run.errorMessage,
    logsUrl: run.logsUrl,
    metrics: run.metrics,
    context: run.context,
    timeoutMs: run.timeoutMs,
    attempt: run.attempt,
    maxAttempts: run.maxAttempts,
    durationMs: run.durationMs,
    scheduledAt: run.scheduledAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

function serializeJobBundle(
  bundle: JobBundleRecord,
  options?: { includeVersions?: boolean; includeManifest?: boolean }
) {
  const payload: Record<string, unknown> = {
    id: bundle.id,
    slug: bundle.slug,
    displayName: bundle.displayName,
    description: bundle.description,
    latestVersion: bundle.latestVersion,
    createdAt: bundle.createdAt,
    updatedAt: bundle.updatedAt
  };

  if (options?.includeVersions && bundle.versions) {
    payload.versions = bundle.versions.map((version) =>
      serializeJobBundleVersion(version, { includeManifest: options.includeManifest })
    );
  }

  return payload;
}

function serializeJobBundleVersion(
  version: JobBundleVersionRecord,
  options?: { includeManifest?: boolean; download?: BundleDownloadInfo | null }
) {
  const downloadInfo = options?.download ?? null;
  return {
    id: version.id,
    bundleId: version.bundleId,
    slug: version.slug,
    version: version.version,
    checksum: version.checksum,
    capabilityFlags: version.capabilityFlags,
    immutable: version.immutable,
    status: version.status,
    artifact: {
      storage: version.artifactStorage,
      contentType: version.artifactContentType,
      size: version.artifactSize
    },
    manifest: options?.includeManifest ? version.manifest : undefined,
    metadata: version.metadata,
    publishedBy: version.publishedBy
      ? {
          subject: version.publishedBy,
          kind: version.publishedByKind,
          tokenHash: version.publishedByTokenHash
        }
      : null,
    publishedAt: version.publishedAt,
    deprecatedAt: version.deprecatedAt,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    download: downloadInfo
      ? {
          url: downloadInfo.url,
          expiresAt: new Date(downloadInfo.expiresAt).toISOString(),
          storage: downloadInfo.storage,
          kind: downloadInfo.kind
        }
      : undefined
  };
}

function decodeBundleArtifactData(encoded: string): Buffer {
  const trimmed = encoded.trim();
  if (!trimmed) {
    throw new Error('Artifact data is required');
  }
  const match = trimmed.match(/^data:[^;]+;base64,(.+)$/i);
  const payload = (match ? match[1] : trimmed).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(payload)) {
    throw new Error('Artifact data must be base64 encoded');
  }
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const paddingNeeded = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  const padded = paddingNeeded > 0 ? `${normalized}${'='.repeat(paddingNeeded)}` : normalized;
  const buffer = Buffer.from(padded, 'base64');
  if (buffer.length === 0) {
    throw new Error('Artifact data is empty');
  }
  if (buffer.length > MAX_BUNDLE_ARTIFACT_BYTES) {
    throw new Error(`Artifact exceeds maximum allowed size of ${MAX_BUNDLE_ARTIFACT_BYTES} bytes`);
  }
  return buffer;
}

function sanitizeDownloadFilename(value: string | undefined, version: string): string {
  const fallbackStem = `bundle-${version}`.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const fallback = `${fallbackStem || 'bundle'}.tgz`;
  if (!value) {
    return fallback;
  }
  const cleaned = value.trim().replace(/[/\\]/g, '');
  if (!cleaned) {
    return fallback;
  }
  const sanitized = cleaned
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  if (!sanitized) {
    return fallback;
  }
  return sanitized.length > 128 ? sanitized.slice(0, 128) : sanitized;
}

function serializeWorkflowDefinition(workflow: WorkflowDefinitionRecord) {
  return {
    id: workflow.id,
    slug: workflow.slug,
    name: workflow.name,
    version: workflow.version,
    description: workflow.description,
    steps: workflow.steps,
    triggers: workflow.triggers,
    parametersSchema: workflow.parametersSchema,
    defaultParameters: workflow.defaultParameters,
    metadata: workflow.metadata,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt
  };
}

function serializeWorkflowRun(run: WorkflowRunRecord) {
  return {
    id: run.id,
    workflowDefinitionId: run.workflowDefinitionId,
    status: run.status,
    parameters: run.parameters,
    context: run.context,
    errorMessage: run.errorMessage,
    currentStepId: run.currentStepId,
    currentStepIndex: run.currentStepIndex,
    metrics: run.metrics,
    triggeredBy: run.triggeredBy,
    trigger: run.trigger,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

function serializeWorkflowRunStep(step: WorkflowRunStepRecord) {
  return {
    id: step.id,
    workflowRunId: step.workflowRunId,
    stepId: step.stepId,
    status: step.status,
    attempt: step.attempt,
    jobRunId: step.jobRunId,
    input: step.input,
    output: step.output,
    errorMessage: step.errorMessage,
    logsUrl: step.logsUrl,
    metrics: step.metrics,
    context: step.context,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    createdAt: step.createdAt,
    updatedAt: step.updatedAt
  };
}

function getStringParameter(parameters: JsonValue, key: string): string | null {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return null;
  }
  const value = (parameters as Record<string, JsonValue>)[key];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type SerializedRepository = ReturnType<typeof serializeRepository>;
type SerializedBuild = ReturnType<typeof serializeBuild>;
type SerializedLaunch = ReturnType<typeof serializeLaunch>;
type SerializedService = ReturnType<typeof serializeService>;
type SerializedWorkflowDefinition = ReturnType<typeof serializeWorkflowDefinition>;
type SerializedWorkflowRun = ReturnType<typeof serializeWorkflowRun>;

type WorkflowRunEventType =
  | 'workflow.run.updated'
  | 'workflow.run.pending'
  | 'workflow.run.running'
  | 'workflow.run.succeeded'
  | 'workflow.run.failed'
  | 'workflow.run.canceled';

type OutboundEvent =
  | { type: 'repository.updated'; data: { repository: SerializedRepository } }
  | { type: 'repository.ingestion-event'; data: { event: IngestionEvent } }
  | { type: 'build.updated'; data: { build: SerializedBuild } }
  | { type: 'launch.updated'; data: { repositoryId: string; launch: SerializedLaunch } }
  | { type: 'service.updated'; data: { service: SerializedService } }
  | { type: 'workflow.definition.updated'; data: { workflow: SerializedWorkflowDefinition } }
  | { type: WorkflowRunEventType; data: { run: SerializedWorkflowRun } };

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
    case 'service.updated':
      return {
        type: 'service.updated',
        data: { service: serializeService(event.data.service) }
      };
    case 'workflow.definition.updated':
      return {
        type: 'workflow.definition.updated',
        data: { workflow: serializeWorkflowDefinition(event.data.workflow) }
      };
    case 'workflow.run.updated':
    case 'workflow.run.pending':
    case 'workflow.run.running':
    case 'workflow.run.succeeded':
    case 'workflow.run.failed':
    case 'workflow.run.canceled':
      return {
        type: event.type,
        data: { run: serializeWorkflowRun(event.data.run) }
      };
    default:
      return null;
  }
}

function toMetadataObject(value: JsonValue | null): Record<string, JsonValue> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, JsonValue>) };
  }
  return {};
}

function mergeRuntimeMetadata(existing: JsonValue | null, incoming: JsonValue | null | undefined): JsonValue | null {
  const base = toMetadataObject(existing);
  if (incoming !== undefined) {
    base.runtime = incoming;
  }
  return Object.keys(base).length > 0 ? (base as JsonValue) : null;
}

function extractBearerToken(header: unknown): string | null {
  if (typeof header !== 'string') {
    return null;
  }
  const match = header.trim().match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  return match[1]?.trim() ?? null;
}

const SERVICE_REGISTRY_TOKEN = process.env.SERVICE_REGISTRY_TOKEN ?? '';

function ensureServiceRegistryAuthorized(request: FastifyRequest, reply: FastifyReply) {
  if (!SERVICE_REGISTRY_TOKEN) {
    reply.status(503);
    return false;
  }
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    reply.status(401);
    return false;
  }
  if (token !== SERVICE_REGISTRY_TOKEN) {
    reply.status(403);
    return false;
  }
  return true;
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

export async function buildServer() {
  const app = Fastify();

  await app.register(cors, {
    origin: true
  });

  await app.register(websocket, {
    options: {
      maxPayload: 1_048_576
    }
  });

  const registry = await initializeServiceRegistry();

  app.addHook('onClose', async () => {
    registry.stop();
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

  app.get('/metrics', async (request, reply) => {
    try {
      const metrics = await computeRunMetrics();
      reply.status(200);
      return { data: metrics };
    } catch (err) {
      request.log.error({ err }, 'Failed to compute run metrics');
      reply.status(500);
      return { error: 'Failed to compute metrics' };
    }
  });

  app.get('/jobs', async (_request, reply) => {
    const jobs = await listJobDefinitions();
    reply.status(200);
    return { data: jobs.map((job) => serializeJobDefinition(job)) };
  });

  app.post('/jobs', async (request, reply) => {
    const auth = await authorizeOperatorAction(request, {
      action: 'jobs.create',
      resource: 'jobs',
      requiredScopes: JOB_WRITE_SCOPES
    });
    if (!auth.ok) {
      reply.status(auth.statusCode);
      return { error: auth.error };
    }

    const parseBody = jobDefinitionCreateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten() });
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;

    try {
      const definition = await createJobDefinition({
        slug: payload.slug,
        name: payload.name,
        type: payload.type,
        entryPoint: payload.entryPoint,
        version: payload.version,
        timeoutMs: payload.timeoutMs ?? null,
        retryPolicy: payload.retryPolicy ?? null,
        parametersSchema: payload.parametersSchema ?? {},
        defaultParameters: payload.defaultParameters ?? {},
        metadata: payload.metadata ?? null
      });
      reply.status(201);
      await auth.log('succeeded', { jobSlug: definition.slug, jobId: definition.id });
      return { data: serializeJobDefinition(definition) };
    } catch (err) {
      if (err instanceof Error && /already exists/i.test(err.message)) {
        reply.status(409);
        await auth.log('failed', { reason: 'duplicate_job', message: err.message });
        return { error: err.message };
      }
      const message = err instanceof Error ? err.message : 'Failed to create job definition';
      request.log.error({ err }, 'Failed to create job definition');
      reply.status(500);
      await auth.log('failed', { reason: 'exception', message });
      return { error: 'Failed to create job definition' };
    }
  });

  app.get('/jobs/:slug', async (request, reply) => {
    const parseParams = z.object({ slug: z.string().min(1) }).safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = jobRunListQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const job = await getJobDefinitionBySlug(parseParams.data.slug);
    if (!job) {
      reply.status(404);
      return { error: 'job not found' };
    }

    const limit = Math.max(1, Math.min(parseQuery.data.limit ?? 10, 50));
    const offset = Math.max(0, parseQuery.data.offset ?? 0);
    const runs = await listJobRunsForDefinition(job.id, { limit, offset });

    reply.status(200);
    return {
      data: {
        job: serializeJobDefinition(job),
        runs: runs.map((run) => serializeJobRun(run))
      },
      meta: {
        limit,
        offset
      }
    };
  });

  app.post('/jobs/:slug/run', async (request, reply) => {
    const rawParams = request.params as Record<string, unknown> | undefined;
    const candidateSlug = typeof rawParams?.slug === 'string' ? rawParams.slug : 'unknown';

    const auth = await authorizeOperatorAction(request, {
      action: 'jobs.run',
      resource: `job:${candidateSlug}`,
      requiredScopes: JOB_RUN_SCOPES
    });
    if (!auth.ok) {
      reply.status(auth.statusCode);
      return { error: auth.error };
    }

    const parseParams = z.object({ slug: z.string().min(1) }).safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await auth.log('failed', { reason: 'invalid_params', details: parseParams.error.flatten() });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = jobRunRequestSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten(), jobSlug: parseParams.data.slug });
      return { error: parseBody.error.flatten() };
    }

    const job = await getJobDefinitionBySlug(parseParams.data.slug);
    if (!job) {
      reply.status(404);
      await auth.log('failed', { reason: 'job_not_found', jobSlug: parseParams.data.slug });
      return { error: 'job not found' };
    }

    const parameters = parseBody.data.parameters ?? job.defaultParameters ?? {};
    const timeoutMs = parseBody.data.timeoutMs ?? job.timeoutMs ?? null;
    const maxAttempts = parseBody.data.maxAttempts ?? job.retryPolicy?.maxAttempts ?? null;

    const run = await createJobRun(job.id, {
      parameters,
      timeoutMs,
      maxAttempts,
      context: parseBody.data.context ?? null
    });

    let latestRun: JobRunRecord | null = run;

    const markFailureAndRespond = async (
      statusCode: number,
      message: string,
      reason: string = 'validation_error'
    ) => {
      reply.status(statusCode);
      await auth.log('failed', {
        reason,
        jobSlug: job.slug,
        runId: run.id,
        message
      });
      return { error: message };
    };

    try {
      if (job.slug === 'repository-ingest') {
        const repositoryId = getStringParameter(run.parameters, 'repositoryId');
        if (!repositoryId) {
          await completeJobRun(run.id, 'failed', {
            errorMessage: 'repositoryId parameter is required'
          });
          return markFailureAndRespond(400, 'repositoryId parameter is required', 'missing_parameter');
        }
        latestRun = await enqueueRepositoryIngestion(repositoryId, {
          jobRunId: run.id,
          parameters: run.parameters
        });
      } else if (job.slug === 'repository-build') {
        const buildId = getStringParameter(run.parameters, 'buildId');
        if (!buildId) {
          await completeJobRun(run.id, 'failed', {
            errorMessage: 'buildId parameter is required'
          });
          return markFailureAndRespond(400, 'buildId parameter is required', 'missing_parameter');
        }
        let repositoryId = getStringParameter(run.parameters, 'repositoryId');
        if (!repositoryId) {
          const build = await getBuildById(buildId);
          repositoryId = build?.repositoryId ?? null;
        }
        if (!repositoryId) {
          await completeJobRun(run.id, 'failed', {
            errorMessage: 'repositoryId parameter is required'
          });
          return markFailureAndRespond(400, 'repositoryId parameter is required', 'missing_parameter');
        }
        latestRun = await enqueueBuildJob(buildId, repositoryId, { jobRunId: run.id });
      } else {
        latestRun = await executeJobRun(run.id);
      }
    } catch (err) {
      request.log.error({ err, slug: job.slug }, 'Failed to execute job run');
      const errorMessage = (err as Error).message ?? 'job execution failed';
      await completeJobRun(run.id, 'failed', {
        errorMessage
      });
      reply.status(502);
      await auth.log('failed', {
        reason: 'execution_error',
        jobSlug: job.slug,
        runId: run.id,
        message: errorMessage
      });
      return { error: errorMessage };
    }

    const responseRun = latestRun ?? (await getJobRunById(run.id)) ?? run;

    reply.status(202);
    await auth.log('succeeded', {
      jobSlug: job.slug,
      runId: responseRun.id,
      status: responseRun.status
    });
    return { data: serializeJobRun(responseRun) };
  });

  app.get('/job-bundles', async (request, reply) => {
    try {
      const bundles = await listJobBundles();
      reply.status(200);
      return { data: bundles.map((bundle) => serializeJobBundle(bundle)) };
    } catch (err) {
      request.log.error({ err }, 'Failed to list job bundles');
      reply.status(500);
      return { error: 'Failed to list job bundles' };
    }
  });

  app.get('/job-bundles/:slug', async (request, reply) => {
    const parseParams = z.object({ slug: z.string().min(1) }).safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    try {
      const bundle = await getBundleWithVersions(parseParams.data.slug);
      if (!bundle) {
        reply.status(404);
        return { error: 'job bundle not found' };
      }
      reply.status(200);
      return { data: serializeJobBundle(bundle, { includeVersions: true }) };
    } catch (err) {
      request.log.error({ err, slug: parseParams.data.slug }, 'Failed to load job bundle');
      reply.status(500);
      return { error: 'Failed to load job bundle' };
    }
  });

  app.post('/job-bundles', async (request, reply) => {
    const auth = await authorizeOperatorAction(request, {
      action: 'job-bundles.publish',
      resource: 'job-bundles',
      requiredScopes: JOB_BUNDLE_WRITE_SCOPES
    });
    if (!auth.ok) {
      reply.status(auth.statusCode);
      return { error: auth.error };
    }

    const parseBody = jobBundlePublishSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten() });
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;

    if (typeof payload.manifest.version === 'string' && payload.manifest.version !== payload.version) {
      reply.status(400);
      const error = 'manifest.version must match the bundle version';
      await auth.log('failed', { reason: 'version_mismatch', message: error, slug: payload.slug, version: payload.version });
      return { error };
    }

    let artifactBuffer: Buffer;
    try {
      artifactBuffer = decodeBundleArtifactData(payload.artifact.data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid artifact payload';
      reply.status(400);
      await auth.log('failed', {
        reason: 'invalid_artifact',
        message,
        slug: payload.slug,
        version: payload.version
      });
      return { error: message };
    }

    const manifestCapabilitiesValue = (payload.manifest as { capabilities?: unknown }).capabilities;
    const manifestCapabilities = Array.isArray(manifestCapabilitiesValue)
      ? manifestCapabilitiesValue
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      : [];

    const capabilityFlagSource: string[] = [
      ...(payload.capabilityFlags ?? []),
      ...manifestCapabilities
    ];
    const capabilityFlags = Array.from(
      new Set(capabilityFlagSource.map((entry) => entry.trim()).filter((entry) => entry.length > 0))
    );

    const manifestPayload = payload.manifest as JsonValue;

    try {
      const result = await publishBundleVersion(
        {
          slug: payload.slug,
          version: payload.version,
          manifest: manifestPayload,
          capabilityFlags,
          immutable: payload.immutable ?? false,
          metadata: payload.metadata ?? null,
          description: payload.description ?? null,
          displayName: payload.displayName ?? null,
          artifact: {
            data: artifactBuffer,
            filename: payload.artifact.filename ?? null,
            contentType: payload.artifact.contentType ?? null,
            checksum: payload.artifact.checksum ?? null
          }
        },
        {
          subject: auth.identity.subject,
          kind: auth.identity.kind,
          tokenHash: auth.identity.tokenHash
        }
      );

      reply.status(201);
      await auth.log('succeeded', {
        action: 'publish_bundle_version',
        slug: result.bundle.slug,
        version: result.version.version,
        storage: result.version.artifactStorage
      });
      return {
        data: {
          bundle: serializeJobBundle(result.bundle),
          version: serializeJobBundleVersion(result.version, {
            includeManifest: true,
            download: result.download
          })
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to publish job bundle version';
      const isConflict = /already exists/i.test(message);
      const isChecksumMismatch = /checksum mismatch/i.test(message);
      const status = isConflict ? 409 : isChecksumMismatch ? 400 : 500;
      request.log.error({ err, slug: payload.slug, version: payload.version }, 'Failed to publish job bundle version');
      reply.status(status);
      await auth.log('failed', {
        reason: isConflict ? 'duplicate_version' : isChecksumMismatch ? 'checksum_mismatch' : 'exception',
        message,
        slug: payload.slug,
        version: payload.version
      });
      return { error: status === 500 ? 'Failed to publish job bundle version' : message };
    }
  });

  app.get('/job-bundles/:slug/versions/:version', async (request, reply) => {
    const parseParams = z
      .object({ slug: z.string().min(1), version: z.string().min(1) })
      .safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    try {
      const result = await getBundleVersionWithDownload(parseParams.data.slug, parseParams.data.version);
      if (!result) {
        reply.status(404);
        return { error: 'job bundle version not found' };
      }
      reply.status(200);
      return {
        data: {
          bundle: serializeJobBundle(result.bundle),
          version: serializeJobBundleVersion(result.version, {
            includeManifest: true,
            download: result.download
          })
        }
      };
    } catch (err) {
      request.log.error({ err, slug: parseParams.data.slug, version: parseParams.data.version }, 'Failed to load job bundle version');
      reply.status(500);
      return { error: 'Failed to load job bundle version' };
    }
  });

  app.patch('/job-bundles/:slug/versions/:version', async (request, reply) => {
    const rawParams = request.params as Record<string, unknown> | undefined;
    const candidateSlug = typeof rawParams?.slug === 'string' ? rawParams.slug : 'unknown';
    const candidateVersion = typeof rawParams?.version === 'string' ? rawParams.version : 'unknown';

    const auth = await authorizeOperatorAction(request, {
      action: 'job-bundles.update',
      resource: `job-bundle:${candidateSlug}@${candidateVersion}`,
      requiredScopes: JOB_BUNDLE_WRITE_SCOPES
    });
    if (!auth.ok) {
      reply.status(auth.statusCode);
      return { error: auth.error };
    }

    const parseParams = z
      .object({ slug: z.string().min(1), version: z.string().min(1) })
      .safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await auth.log('failed', { reason: 'invalid_params', details: parseParams.error.flatten() });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = jobBundleUpdateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten() });
      return { error: parseBody.error.flatten() };
    }

    try {
      const updateInput: { deprecated?: boolean; metadata?: JsonValue | null } = {};
      if (parseBody.data.deprecated !== undefined) {
        updateInput.deprecated = parseBody.data.deprecated;
      }
      if (Object.prototype.hasOwnProperty.call(parseBody.data, 'metadata')) {
        updateInput.metadata = parseBody.data.metadata ?? null;
      }

      const updated = await updateJobBundleVersionRecord(parseParams.data.slug, parseParams.data.version, updateInput);
      if (!updated) {
        reply.status(404);
        await auth.log('failed', {
          reason: 'not_found',
          slug: parseParams.data.slug,
          version: parseParams.data.version
        });
        return { error: 'job bundle version not found' };
      }

      const latest = await getBundleVersionWithDownload(parseParams.data.slug, parseParams.data.version);
      const responseBundleRecord = latest?.bundle ?? (await getBundle(parseParams.data.slug));
      const responseVersion = latest?.version ?? updated;
      const downloadInfo = latest?.download ?? null;

      reply.status(200);
      await auth.log('succeeded', {
        action: 'update_bundle_version',
        slug: parseParams.data.slug,
        version: parseParams.data.version,
        status: updated.status
      });
      return {
        data: {
          bundle: responseBundleRecord ? serializeJobBundle(responseBundleRecord) : null,
          version: serializeJobBundleVersion(responseVersion, {
            includeManifest: true,
            download: downloadInfo
          })
        }
      };
    } catch (err) {
      request.log.error({ err, slug: parseParams.data.slug, version: parseParams.data.version }, 'Failed to update job bundle version');
      reply.status(500);
      await auth.log('failed', {
        reason: 'exception',
        message: err instanceof Error ? err.message : 'unknown error',
        slug: parseParams.data.slug,
        version: parseParams.data.version
      });
      return { error: 'Failed to update job bundle version' };
    }
  });

  app.get('/job-bundles/:slug/versions/:version/download', async (request, reply) => {
    const parseParams = z
      .object({ slug: z.string().min(1), version: z.string().min(1) })
      .safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const bundleVersion = await getJobBundleVersion(parseParams.data.slug, parseParams.data.version);
    if (!bundleVersion) {
      reply.status(404);
      return { error: 'job bundle version not found' };
    }

    if (bundleVersion.artifactStorage === 's3') {
      reply.status(400);
      return { error: 's3-backed artifacts must be downloaded via the provided signed URL' };
    }

    const parseQuery = z
      .object({
        expires: z.string().min(1),
        token: z.string().min(1),
        filename: z.string().min(1).max(256).optional()
      })
      .safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const expiresAt = Number(parseQuery.data.expires);
    if (!Number.isFinite(expiresAt)) {
      reply.status(400);
      return { error: 'invalid expires value' };
    }

    if (!verifyLocalBundleDownload(bundleVersion, parseQuery.data.token, expiresAt)) {
      reply.status(403);
      return { error: 'invalid or expired download token' };
    }

    try {
      await ensureLocalBundleExists(bundleVersion);
      const stream = await openLocalBundleArtifact(bundleVersion);
      const filename = sanitizeDownloadFilename(parseQuery.data.filename, bundleVersion.version);
      if (bundleVersion.artifactSize !== null) {
        reply.header('Content-Length', String(bundleVersion.artifactSize));
      }
      reply.header('Content-Type', bundleVersion.artifactContentType ?? 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Cache-Control', 'no-store');
      reply.status(200);
      return reply.send(stream);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'failed to open artifact';
      request.log.error({ err, slug: parseParams.data.slug, version: parseParams.data.version }, 'Failed to stream bundle artifact');
      reply.status(404);
      return { error: message };
    }
  });

  app.get('/workflows', async (_request, reply) => {
    try {
      const workflows = await listWorkflowDefinitions();
      reply.status(200);
      return { data: workflows.map((workflow) => serializeWorkflowDefinition(workflow)) };
    } catch (err) {
      reply.status(500);
      return { error: 'Failed to list workflows' };
    }
  });

  app.post('/workflows', async (request, reply) => {
    const auth = await authorizeOperatorAction(request, {
      action: 'workflows.create',
      resource: 'workflows',
      requiredScopes: WORKFLOW_WRITE_SCOPES
    });
    if (!auth.ok) {
      reply.status(auth.statusCode);
      return { error: auth.error };
    }

    const parseBody = workflowDefinitionCreateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten() });
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const steps = normalizeWorkflowSteps(payload.steps);
    const triggers = normalizeWorkflowTriggers(payload.triggers);

    try {
      const workflow = await createWorkflowDefinition({
        slug: payload.slug,
        name: payload.name,
        version: payload.version,
        description: payload.description ?? null,
        steps,
        triggers,
        parametersSchema: payload.parametersSchema ?? {},
        defaultParameters: payload.defaultParameters ?? {},
        metadata: payload.metadata ?? null
      });
      reply.status(201);
      await auth.log('succeeded', { workflowSlug: workflow.slug, workflowId: workflow.id });
      return { data: serializeWorkflowDefinition(workflow) };
    } catch (err) {
      if (err instanceof Error && /already exists/i.test(err.message)) {
        reply.status(409);
        await auth.log('failed', { reason: 'duplicate_workflow', message: err.message });
        return { error: err.message };
      }
      request.log.error({ err }, 'Failed to create workflow definition');
      reply.status(500);
      const message = err instanceof Error ? err.message : 'Failed to create workflow definition';
      await auth.log('failed', { reason: 'exception', message });
      return { error: 'Failed to create workflow definition' };
    }
  });

  app.patch('/workflows/:slug', async (request, reply) => {
    const rawParams = request.params as Record<string, unknown> | undefined;
    const candidateSlug = typeof rawParams?.slug === 'string' ? rawParams.slug : 'unknown';

    const auth = await authorizeOperatorAction(request, {
      action: 'workflows.update',
      resource: `workflow:${candidateSlug}`,
      requiredScopes: WORKFLOW_WRITE_SCOPES
    });
    if (!auth.ok) {
      reply.status(auth.statusCode);
      return { error: auth.error };
    }

    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await auth.log('failed', { reason: 'invalid_params', details: parseParams.error.flatten() });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = workflowDefinitionUpdateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten() });
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const updates: Parameters<typeof updateWorkflowDefinition>[1] = {};

    if (payload.name !== undefined) {
      updates.name = payload.name;
    }
    if (payload.version !== undefined) {
      updates.version = payload.version;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'description')) {
      updates.description = payload.description ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'steps')) {
      updates.steps = normalizeWorkflowSteps(payload.steps!);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'triggers')) {
      updates.triggers = normalizeWorkflowTriggers(payload.triggers ?? []) ?? [];
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'parametersSchema')) {
      updates.parametersSchema = payload.parametersSchema ?? {};
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'defaultParameters')) {
      updates.defaultParameters = payload.defaultParameters ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'metadata')) {
      updates.metadata = payload.metadata ?? null;
    }

    try {
      const workflow = await updateWorkflowDefinition(parseParams.data.slug, updates);
      if (!workflow) {
        reply.status(404);
        await auth.log('failed', { reason: 'workflow_not_found', workflowSlug: parseParams.data.slug });
        return { error: 'workflow not found' };
      }

      reply.status(200);
      await auth.log('succeeded', { workflowSlug: workflow.slug, workflowId: workflow.id });
      return { data: serializeWorkflowDefinition(workflow) };
    } catch (err) {
      request.log.error({ err, slug: parseParams.data.slug }, 'Failed to update workflow definition');
      reply.status(500);
      const message = err instanceof Error ? err.message : 'Failed to update workflow definition';
      await auth.log('failed', { reason: 'exception', message, workflowSlug: parseParams.data.slug });
      return { error: 'Failed to update workflow definition' };
    }
  });

  app.get('/workflows/:slug', async (request, reply) => {
    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = workflowRunListQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      return { error: 'workflow not found' };
    }

    const limit = Math.max(1, Math.min(parseQuery.data.limit ?? 10, 50));
    const offset = Math.max(0, parseQuery.data.offset ?? 0);
    const runs = await listWorkflowRunsForDefinition(workflow.id, { limit, offset });

    reply.status(200);
    return {
      data: {
        workflow: serializeWorkflowDefinition(workflow),
        runs: runs.map((run) => serializeWorkflowRun(run))
      },
      meta: {
        limit,
        offset
      }
    };
  });

  app.get('/workflows/:slug/runs', async (request, reply) => {
    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = workflowRunListQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      return { error: 'workflow not found' };
    }

    const limit = Math.max(1, Math.min(parseQuery.data.limit ?? 20, 50));
    const offset = Math.max(0, parseQuery.data.offset ?? 0);
    const runs = await listWorkflowRunsForDefinition(workflow.id, { limit, offset });

    reply.status(200);
    return {
      data: {
        runs: runs.map((run) => serializeWorkflowRun(run))
      },
      meta: {
        workflow: {
          id: workflow.id,
          slug: workflow.slug,
          name: workflow.name
        },
        limit,
        offset
      }
    };
  });

  app.post('/workflows/:slug/run', async (request, reply) => {
    const rawParams = request.params as Record<string, unknown> | undefined;
    const candidateSlug = typeof rawParams?.slug === 'string' ? rawParams.slug : 'unknown';

    const auth = await authorizeOperatorAction(request, {
      action: 'workflows.run',
      resource: `workflow:${candidateSlug}`,
      requiredScopes: WORKFLOW_RUN_SCOPES
    });
    if (!auth.ok) {
      reply.status(auth.statusCode);
      return { error: auth.error };
    }

    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await auth.log('failed', { reason: 'invalid_params', details: parseParams.error.flatten() });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = workflowRunRequestSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten(),
        workflowSlug: parseParams.data.slug
      });
      return { error: parseBody.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      await auth.log('failed', { reason: 'workflow_not_found', workflowSlug: parseParams.data.slug });
      return { error: 'workflow not found' };
    }

    const parameters = parseBody.data.parameters ?? workflow.defaultParameters ?? {};
    const triggeredBy = parseBody.data.triggeredBy ?? null;
    const trigger = parseBody.data.trigger ?? undefined;

    const run = await createWorkflowRun(workflow.id, {
      parameters,
      triggeredBy,
      trigger
    });

    try {
      await enqueueWorkflowRun(run.id);
    } catch (err) {
      request.log.error({ err, workflow: workflow.slug }, 'Failed to enqueue workflow run');
      const message = (err as Error).message ?? 'Failed to enqueue workflow run';
      await updateWorkflowRun(run.id, {
        status: 'failed',
        errorMessage: message,
        completedAt: new Date().toISOString(),
        durationMs: 0
      });
      reply.status(502);
      await auth.log('failed', {
        reason: 'enqueue_failed',
        workflowSlug: workflow.slug,
        runId: run.id,
        message
      });
      return { error: message };
    }

    const latestRun = (await getWorkflowRunById(run.id)) ?? run;
    reply.status(202);
    await auth.log('succeeded', {
      workflowSlug: workflow.slug,
      runId: latestRun.id,
      status: latestRun.status
    });
    return { data: serializeWorkflowRun(latestRun) };
  });

  app.get('/workflow-runs/:runId', async (request, reply) => {
    const parseParams = workflowRunIdParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const run = await getWorkflowRunById(parseParams.data.runId);
    if (!run) {
      reply.status(404);
      return { error: 'workflow run not found' };
    }

    reply.status(200);
    return { data: serializeWorkflowRun(run) };
  });

  app.get('/workflow-runs/:runId/steps', async (request, reply) => {
    const parseParams = workflowRunIdParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const run = await getWorkflowRunById(parseParams.data.runId);
    if (!run) {
      reply.status(404);
      return { error: 'workflow run not found' };
    }

    const steps = await listWorkflowRunSteps(run.id);

    reply.status(200);
    return {
      data: {
        run: serializeWorkflowRun(run),
        steps: steps.map((step) => serializeWorkflowRunStep(step))
      }
    };
  });

  app.get('/services', async () => {
    const services = await listServices();
    const healthyCount = services.filter((service) => service.status === 'healthy').length;
    const unhealthyCount = services.length - healthyCount;
    return {
      data: services.map((service) => serializeService(service)),
      meta: {
        total: services.length,
        healthyCount,
        unhealthyCount
      }
    };
  });

  app.post('/services', async (request, reply) => {
    if (!ensureServiceRegistryAuthorized(request, reply)) {
      return { error: 'service registry disabled' };
    }

    const parseBody = serviceRegistrationSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const existing = await getServiceBySlug(payload.slug);
    const mergedMetadata = mergeRuntimeMetadata(existing?.metadata ?? null, payload.metadata);

    const upsertPayload: ServiceUpsertInput = {
      slug: payload.slug,
      displayName: payload.displayName,
      kind: payload.kind,
      baseUrl: payload.baseUrl,
      metadata: mergedMetadata
    };

    if (payload.status !== undefined) {
      upsertPayload.status = payload.status;
    }
    if (payload.statusMessage !== undefined) {
      upsertPayload.statusMessage = payload.statusMessage;
    }
    if (payload.capabilities !== undefined) {
      upsertPayload.capabilities = payload.capabilities;
    }

    const record = await upsertService(upsertPayload);
    if (!existing) {
      reply.status(201);
    }
    return { data: serializeService(record) };
  });

  app.post('/service-config/import', async (request, reply) => {
    if (!ensureServiceRegistryAuthorized(request, reply)) {
      return { error: 'service registry disabled' };
    }

    const parseBody = serviceConfigImportSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const repo = payload.repo.trim();
    const ref = payload.ref?.trim() || undefined;
    const commit = payload.commit?.trim() || undefined;
    const configPath = payload.configPath?.trim() || undefined;
    const moduleHint = payload.module?.trim() || undefined;

    let preview;
    try {
      preview = await previewServiceConfigImport({ repo, ref, commit, configPath, module: moduleHint });
    } catch (err) {
      reply.status(400);
      return { error: (err as Error).message };
    }

    if (preview.errors.length > 0) {
      reply.status(400);
      return {
        error: preview.errors.map((entry) => ({ source: entry.source, message: entry.error.message }))
      };
    }

    const configPaths = resolveServiceConfigPaths();
    let targetConfigPath: string | null = null;
    for (const candidate of configPaths) {
      try {
        await fs.access(candidate);
        targetConfigPath = candidate;
        break;
      } catch {
        continue;
      }
    }

    if (!targetConfigPath) {
      targetConfigPath = configPaths[0] ?? DEFAULT_SERVICE_CONFIG_PATH;
      try {
        await fs.access(targetConfigPath);
      } catch (err) {
        reply.status(500);
        return {
          error: `service config not found at ${targetConfigPath}: ${(err as Error).message}`
        };
      }
    }

    try {
      await appendServiceConfigImport(targetConfigPath, {
        module: preview.moduleId,
        repo,
        ref,
        commit,
        configPath,
        resolvedCommit: preview.resolvedCommit
      });
    } catch (err) {
      if (err instanceof DuplicateModuleImportError) {
        reply.status(409);
        return { error: err.message };
      }
      reply.status(500);
      return { error: (err as Error).message };
    }

    await registry.refreshManifest();

    reply.status(201);
    return {
      data: {
        module: preview.moduleId,
        resolvedCommit: preview.resolvedCommit ?? commit ?? null,
        servicesDiscovered: preview.entries.length,
        configPath: targetConfigPath
      }
    };
  });

  app.post('/service-networks/import', async (request, reply) => {
    const parseBody = serviceConfigImportSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const repo = payload.repo.trim();
    const ref = payload.ref?.trim() || undefined;
    const commit = payload.commit?.trim() || undefined;
    const configPath = payload.configPath?.trim() || undefined;
    const moduleHint = payload.module?.trim() || undefined;

    let preview;
    try {
      preview = await previewServiceConfigImport({ repo, ref, commit, configPath, module: moduleHint });
    } catch (err) {
      reply.status(400);
      return { error: (err as Error).message };
    }

    if (preview.errors.length > 0) {
      reply.status(400);
      return {
        error: preview.errors.map((entry) => ({ source: entry.source, message: entry.error.message }))
      };
    }

    const configPaths = resolveServiceConfigPaths();
    let targetConfigPath: string | null = null;
    for (const candidate of configPaths) {
      try {
        await fs.access(candidate);
        targetConfigPath = candidate;
        break;
      } catch {
        continue;
      }
    }

    if (!targetConfigPath) {
      targetConfigPath = configPaths[0] ?? DEFAULT_SERVICE_CONFIG_PATH;
      try {
        await fs.access(targetConfigPath);
      } catch (err) {
        reply.status(500);
        return {
          error: `service config not found at ${targetConfigPath}: ${(err as Error).message}`
        };
      }
    }

    try {
      await appendServiceConfigImport(targetConfigPath, {
        module: preview.moduleId,
        repo,
        ref,
        commit,
        configPath,
        resolvedCommit: preview.resolvedCommit
      });
    } catch (err) {
      if (err instanceof DuplicateModuleImportError) {
        reply.status(409);
        return { error: err.message };
      }
      reply.status(500);
      return { error: (err as Error).message };
    }

    await registry.refreshManifest();

    reply.status(201);
    return {
      data: {
        module: preview.moduleId,
        resolvedCommit: preview.resolvedCommit ?? commit ?? null,
        servicesDiscovered: preview.entries.length,
        networksDiscovered: preview.networks.length,
        configPath: targetConfigPath
      }
    };
  });

  app.patch('/services/:slug', async (request, reply) => {
    if (!ensureServiceRegistryAuthorized(request, reply)) {
      return { error: 'service registry disabled' };
    }

    const paramsSchema = z.object({ slug: z.string().min(1) });
    const parseParams = paramsSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const slug = parseParams.data.slug;
    const existing = await getServiceBySlug(slug);
    if (!existing) {
      reply.status(404);
      return { error: 'service not found' };
    }

    const parseBody = servicePatchSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    let metadataUpdate: JsonValue | null | undefined;
    if (Object.prototype.hasOwnProperty.call(payload, 'metadata')) {
      metadataUpdate = mergeRuntimeMetadata(existing.metadata, payload.metadata ?? null);
    }

    const update: ServiceStatusUpdate = {};
    if (payload.baseUrl) {
      update.baseUrl = payload.baseUrl;
    }
    if (payload.status !== undefined) {
      update.status = payload.status;
    }
    if (payload.statusMessage !== undefined) {
      update.statusMessage = payload.statusMessage;
    }
    if (payload.capabilities !== undefined) {
      update.capabilities = payload.capabilities;
    }
    if (metadataUpdate !== undefined) {
      update.metadata = metadataUpdate;
    }
    if (payload.lastHealthyAt !== undefined) {
      update.lastHealthyAt = payload.lastHealthyAt;
    }

    const updated = await setServiceStatus(slug, update);
    if (!updated) {
      reply.status(500);
      return { error: 'failed to update service' };
    }

    return { data: serializeService(updated) };
  });

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

    const existing = await getBuildById(parseParams.data.id);
    if (!existing) {
      reply.status(404);
      return { error: 'build not found' };
    }

    if (existing.status !== 'failed') {
      reply.status(409);
      return { error: 'only failed builds can be retried' };
    }

    const repository = await getRepositoryById(existing.repositoryId);
    if (!repository) {
      reply.status(404);
      return { error: 'repository missing for build' };
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

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? '::';

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
}
