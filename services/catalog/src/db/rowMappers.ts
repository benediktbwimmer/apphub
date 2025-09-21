import type { ManifestEnvVarInput } from '../serviceManifestTypes';
import {
  type BuildRecord,
  type IngestStatus,
  type LaunchEnvVar,
  type LaunchRecord,
  type JsonValue,
  type RepositoryPreview,
  type RepositoryPreviewKind,
  type RepositoryRecord,
  type TagKV,
  type BuildStatus,
  type LaunchStatus,
  type ServiceNetworkMemberRecord,
  type ServiceNetworkRecord,
  type ServiceNetworkLaunchMemberRecord,
  type JobDefinitionRecord,
  type JobType,
  type JobRetryPolicy,
  type JobRunRecord,
  type JobRunStatus,
  type JobBundleRecord,
  type JobBundleVersionRecord,
  type JobBundleStorageKind,
  type JobBundleVersionStatus,
  type WorkflowDefinitionRecord,
  type WorkflowTriggerDefinition,
  type WorkflowStepDefinition,
  type WorkflowFanOutStepDefinition,
  type WorkflowFanOutTemplateDefinition,
  type WorkflowServiceStepDefinition,
  type WorkflowServiceRequestHeaderValue,
  type WorkflowServiceRequestDefinition,
  type WorkflowDagMetadata,
  type SecretReference,
  type WorkflowRunRecord,
  type WorkflowRunStatus,
  type WorkflowRunStepRecord,
  type WorkflowRunStepStatus
} from './types';
import type {
  BuildRow,
  IngestionEventRow,
  LaunchRow,
  RepositoryPreviewRow,
  RepositoryRow,
  ServiceNetworkLaunchMemberRow,
  ServiceNetworkMemberRow,
  ServiceNetworkRow,
  ServiceRow,
  TagRow,
  JobDefinitionRow,
  JobRunRow,
  JobBundleRow,
  JobBundleVersionRow,
  WorkflowDefinitionRow,
  WorkflowRunRow,
  WorkflowRunStepRow
} from './rowTypes';
import type { ServiceRecord, IngestionEvent } from './types';

export function parseLaunchEnv(value: unknown): LaunchEnvVar[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const key = typeof (entry as any).key === 'string' ? (entry as any).key.trim() : '';
        if (!key) {
          return null;
        }
        const rawValue = (entry as any).value;
        return { key, value: typeof rawValue === 'string' ? rawValue : '' } satisfies LaunchEnvVar;
      })
      .filter((entry): entry is LaunchEnvVar => Boolean(entry));
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseLaunchEnv(parsed);
    } catch {
      return [];
    }
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, raw]) => ({ key, value: typeof raw === 'string' ? raw : raw === undefined || raw === null ? '' : String(raw) }))
      .filter((entry) => entry.key.length > 0);
  }
  return [];
}

export function parseManifestEnv(value: unknown): ManifestEnvVarInput[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }
        const key = typeof (entry as any).key === 'string' ? (entry as any).key.trim() : '';
        if (!key) {
          return null;
        }
        const clone: ManifestEnvVarInput = { key };
        if (Object.prototype.hasOwnProperty.call(entry, 'value')) {
          const rawValue = (entry as any).value;
          if (rawValue === undefined || rawValue === null) {
            clone.value = undefined;
          } else {
            clone.value = String(rawValue);
          }
        }
        if (Object.prototype.hasOwnProperty.call(entry, 'fromService')) {
          const ref = (entry as any).fromService;
          if (ref && typeof ref === 'object') {
            const service = typeof ref.service === 'string' ? ref.service : undefined;
            if (service) {
              clone.fromService = {
                service,
                property: typeof ref.property === 'string' ? ref.property : undefined,
                fallback:
                  ref.fallback === undefined || ref.fallback === null ? undefined : String(ref.fallback)
              };
            }
          }
        }
        return clone;
      })
      .filter((entry): entry is ManifestEnvVarInput => Boolean(entry));
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseManifestEnv(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

export function parseStringArray(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : null))
      .filter((entry): entry is string => Boolean(entry));
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseStringArray(parsed);
    } catch {
      return value.split(',').map((entry) => entry.trim()).filter(Boolean);
    }
  }
  return [];
}

function toJsonValue(value: unknown): JsonValue | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value as JsonValue;
  }
  if (typeof value === 'object') {
    return value as JsonValue;
  }
  return null;
}

function ensureJsonValue(value: unknown, fallback: JsonValue): JsonValue {
  const parsed = toJsonValue(value);
  return parsed === null ? fallback : parsed;
}

function ensureJsonObject(value: unknown): JsonValue {
  const parsed = toJsonValue(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed;
  }
  return {};
}

function parseWorkflowDag(value: unknown): WorkflowDagMetadata {
  const defaultDag: WorkflowDagMetadata = {
    adjacency: {},
    roots: [],
    topologicalOrder: [],
    edges: 0
  };

  if (value === null || value === undefined) {
    return defaultDag;
  }

  let candidate: unknown = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch {
      return defaultDag;
    }
  }

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return defaultDag;
  }

  const record = candidate as Record<string, unknown>;
  const adjacencyCandidate = record.adjacency;
  const adjacency: Record<string, string[]> = {};
  if (adjacencyCandidate && typeof adjacencyCandidate === 'object' && !Array.isArray(adjacencyCandidate)) {
    for (const [key, entry] of Object.entries(adjacencyCandidate)) {
      adjacency[key] = parseStringArray(entry);
    }
  }

  const roots = parseStringArray(record.roots);
  const topologicalOrder = parseStringArray(record.topologicalOrder ?? record.order);
  const edgesCandidate = record.edges;
  const edges = typeof edgesCandidate === 'number' && Number.isFinite(edgesCandidate) && edgesCandidate >= 0
    ? Math.floor(edgesCandidate)
    : Object.values(adjacency).reduce((acc, dependents) => acc + dependents.length, 0);

  return {
    adjacency,
    roots,
    topologicalOrder,
    edges
  } satisfies WorkflowDagMetadata;
}

function toJsonObjectOrNull(value: unknown): JsonValue | null {
  const parsed = toJsonValue(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed;
  }
  return null;
}

function parseWorkflowTriggers(value: unknown): WorkflowTriggerDefinition[] {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseWorkflowTriggers(parsed);
    } catch {
      return [];
    }
  }
  const entries = Array.isArray(value) ? value : [value];
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const rawType = (entry as Record<string, unknown>).type;
      const type = typeof rawType === 'string' ? rawType.trim() : '';
      if (!type) {
        return null;
      }
      const trigger: WorkflowTriggerDefinition = { type };
      if (Object.prototype.hasOwnProperty.call(entry, 'options')) {
        const optionsValue = toJsonValue((entry as Record<string, unknown>).options);
        if (optionsValue !== null) {
          trigger.options = optionsValue;
        }
      }
      return trigger;
    })
    .filter((entry): entry is WorkflowTriggerDefinition => Boolean(entry));
}

function parseSecretReference(value: unknown): SecretReference | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const source = typeof record.source === 'string' ? record.source.trim().toLowerCase() : '';
  if (source !== 'env' && source !== 'store') {
    return null;
  }
  const key = typeof record.key === 'string' ? record.key.trim() : '';
  if (!key) {
    return null;
  }
  if (source === 'store') {
    const version = typeof record.version === 'string' ? record.version.trim() : undefined;
    return {
      source: 'store',
      key,
      version: version && version.length > 0 ? version : undefined
    } satisfies SecretReference;
  }
  return { source: 'env', key } satisfies SecretReference;
}

function parseServiceHeaderValue(value: unknown): WorkflowServiceRequestHeaderValue | null {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const secret = parseSecretReference(record.secret);
  if (!secret) {
    return null;
  }
  const prefix = typeof record.prefix === 'string' ? record.prefix : undefined;
  return { secret, prefix } satisfies WorkflowServiceRequestHeaderValue;
}

function parseServiceRequest(value: unknown): WorkflowServiceRequestDefinition | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const rawPath = typeof record.path === 'string' ? record.path.trim() : '';
  if (!rawPath) {
    return null;
  }
  const request: WorkflowServiceRequestDefinition = {
    path: rawPath
  };

  const methodRaw = typeof record.method === 'string' ? record.method.trim().toUpperCase() : '';
  if (methodRaw) {
    if (['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(methodRaw)) {
      request.method = methodRaw as WorkflowServiceRequestDefinition['method'];
    }
  }

  if (record.headers && typeof record.headers === 'object' && !Array.isArray(record.headers)) {
    const headers: Record<string, WorkflowServiceRequestHeaderValue> = {};
    for (const [key, headerValue] of Object.entries(record.headers as Record<string, unknown>)) {
      const normalizedKey = key.trim();
      if (!normalizedKey) {
        continue;
      }
      const parsedValue = parseServiceHeaderValue(headerValue);
      if (parsedValue !== null) {
        headers[normalizedKey] = parsedValue;
      }
    }
    if (Object.keys(headers).length > 0) {
      request.headers = headers;
    }
  }

  if (record.query && typeof record.query === 'object' && !Array.isArray(record.query)) {
    const query: Record<string, string | number | boolean> = {};
    for (const [key, rawValue] of Object.entries(record.query as Record<string, unknown>)) {
      const normalizedKey = key.trim();
      if (!normalizedKey) {
        continue;
      }
      if (
        typeof rawValue === 'string' ||
        typeof rawValue === 'number' ||
        typeof rawValue === 'boolean'
      ) {
        query[normalizedKey] = rawValue;
      }
    }
    if (Object.keys(query).length > 0) {
      request.query = query;
    }
  }

  if (Object.prototype.hasOwnProperty.call(record, 'body')) {
    request.body = toJsonValue(record.body);
  }

  return request;
}

function parseServiceWorkflowStep(
  record: Record<string, unknown>,
  id: string,
  name: string
): WorkflowServiceStepDefinition | null {
  const serviceSlugRaw = typeof record.serviceSlug === 'string' ? record.serviceSlug.trim() : '';
  if (!serviceSlugRaw) {
    return null;
  }
  const serviceSlug = serviceSlugRaw.toLowerCase();

  let request = parseServiceRequest(record.request);
  if (!request) {
    const fallbackPath = typeof record.endpoint === 'string' ? record.endpoint.trim() : '';
    if (!fallbackPath) {
      return null;
    }
    const fallbackMethod = typeof record.method === 'string' ? record.method.trim().toUpperCase() : undefined;
    request = parseServiceRequest({
      path: fallbackPath,
      method: fallbackMethod,
      headers: record.headers && typeof record.headers === 'object' ? (record.headers as Record<string, unknown>) : undefined,
      query: record.query && typeof record.query === 'object' ? (record.query as Record<string, unknown>) : undefined,
      body: Object.prototype.hasOwnProperty.call(record, 'body') ? record.body : undefined
    });
  }
  if (!request) {
    return null;
  }

  const step: WorkflowServiceStepDefinition = {
    id,
    name,
    type: 'service',
    serviceSlug,
    request
  };

  if (typeof record.description === 'string' && record.description.trim()) {
    step.description = record.description;
  }

  const dependsOn = parseStringArray(record.dependsOn ?? record.depends_on);
  if (dependsOn.length > 0) {
    step.dependsOn = Array.from(new Set(dependsOn));
  }

  const dependents = parseStringArray((record as Record<string, unknown>).dependents);
  if (dependents.length > 0) {
    step.dependents = Array.from(new Set(dependents));
  }

  const parameters = toJsonValue(record.parameters);
  if (parameters !== null) {
    step.parameters = parameters;
  }

  const timeoutCandidate = record.timeoutMs ?? record.timeout_ms;
  if (typeof timeoutCandidate === 'number' && Number.isFinite(timeoutCandidate) && timeoutCandidate >= 0) {
    step.timeoutMs = Math.floor(timeoutCandidate);
  }

  const retryPolicyRaw = record.retryPolicy ?? record.retry_policy;
  const retryPolicy = toJsonObjectOrNull(retryPolicyRaw);
  if (retryPolicy) {
    step.retryPolicy = retryPolicy as JobRetryPolicy;
  }

  if (Object.prototype.hasOwnProperty.call(record, 'requireHealthy')) {
    step.requireHealthy = Boolean(record.requireHealthy);
  }
  if (Object.prototype.hasOwnProperty.call(record, 'allowDegraded')) {
    step.allowDegraded = Boolean(record.allowDegraded);
  }
  if (Object.prototype.hasOwnProperty.call(record, 'captureResponse')) {
    step.captureResponse = Boolean(record.captureResponse);
  }
  const storeResponseAs = typeof record.storeResponseAs === 'string' ? record.storeResponseAs.trim() : '';
  if (storeResponseAs) {
    step.storeResponseAs = storeResponseAs;
  }

  return step;
}

function parseJobWorkflowStep(
  record: Record<string, unknown>,
  id: string,
  name: string
): WorkflowJobStepDefinition | null {
  const jobSlug = typeof record.jobSlug === 'string' ? record.jobSlug.trim() : '';
  if (!jobSlug) {
    return null;
  }

  const step: WorkflowJobStepDefinition = {
    id,
    name,
    type: 'job',
    jobSlug
  };

  if (typeof record.description === 'string' && record.description.trim()) {
    step.description = record.description;
  }

  const dependsOn = parseStringArray(record.dependsOn ?? record.depends_on);
  if (dependsOn.length > 0) {
    step.dependsOn = Array.from(new Set(dependsOn));
  }

  const dependents = parseStringArray(record.dependents);
  if (dependents.length > 0) {
    step.dependents = Array.from(new Set(dependents));
  }

  const parameters = toJsonValue(record.parameters);
  if (parameters !== null) {
    step.parameters = parameters;
  }

  const timeoutCandidate = record.timeoutMs ?? record.timeout_ms;
  if (typeof timeoutCandidate === 'number' && Number.isFinite(timeoutCandidate) && timeoutCandidate >= 0) {
    step.timeoutMs = Math.floor(timeoutCandidate);
  }

  const retryPolicyRaw = record.retryPolicy ?? record.retry_policy;
  const retryPolicy = toJsonObjectOrNull(retryPolicyRaw);
  if (retryPolicy) {
    step.retryPolicy = retryPolicy as JobRetryPolicy;
  }

  const storeResultAs = typeof record.storeResultAs === 'string' ? record.storeResultAs.trim() : '';
  if (storeResultAs) {
    step.storeResultAs = storeResultAs;
  }

  return step;
}

function parseFanOutTemplate(record: Record<string, unknown>): WorkflowFanOutTemplateDefinition | null {
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) {
    return null;
  }

  const name = typeof record.name === 'string' && record.name.trim().length > 0 ? record.name.trim() : id;
  const type = typeof record.type === 'string' ? record.type.trim().toLowerCase() : '';

  if (type === 'service') {
    const serviceStep = parseServiceWorkflowStep(record, id, name);
    if (!serviceStep) {
      return null;
    }
    const { dependents, ...rest } = serviceStep;
    return rest;
  }

  if (type === 'job') {
    const jobStep = parseJobWorkflowStep(record, id, name);
    if (!jobStep) {
      return null;
    }
    const { dependents, ...rest } = jobStep;
    return rest;
  }

  return null;
}

function parseWorkflowSteps(value: unknown): WorkflowStepDefinition[] {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseWorkflowSteps(parsed);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const seenIds = new Set<string>();
  const steps: WorkflowStepDefinition[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id || seenIds.has(id)) {
      continue;
    }
    const type = typeof record.type === 'string' ? record.type.trim().toLowerCase() : 'job';
    if (type !== 'job' && type !== 'service' && type !== 'fanout') {
      continue;
    }
    const name = typeof record.name === 'string' && record.name.trim().length > 0 ? record.name.trim() : id;

    if (type === 'service') {
      const serviceStep = parseServiceWorkflowStep(record, id, name);
      if (!serviceStep) {
        continue;
      }
      seenIds.add(id);
      steps.push(serviceStep);
      continue;
    }
    if (type === 'fanout') {
      const templateRaw = record.template;
      if (!templateRaw || typeof templateRaw !== 'object') {
        continue;
      }
      const template = parseFanOutTemplate(templateRaw as Record<string, unknown>);
      if (!template) {
        continue;
      }

      let collection: JsonValue | string = [] as JsonValue;
      if (typeof record.collection === 'string') {
        collection = record.collection;
      } else {
        const collectionValue = toJsonValue(record.collection);
        if (collectionValue !== null) {
          collection = collectionValue;
        }
      }

      const fanOutStep: WorkflowFanOutStepDefinition = {
        id,
        name,
        type: 'fanout',
        collection,
        template
      };

      if (typeof record.description === 'string' && record.description.trim()) {
        fanOutStep.description = record.description;
      }

      const dependsOn = parseStringArray(record.dependsOn ?? record.depends_on);
      if (dependsOn.length > 0) {
        fanOutStep.dependsOn = Array.from(new Set(dependsOn));
      }

      const dependents = parseStringArray(record.dependents);
      if (dependents.length > 0) {
        fanOutStep.dependents = Array.from(new Set(dependents));
      }

      const maxItemsCandidate = record.maxItems ?? record.max_items;
      if (
        typeof maxItemsCandidate === 'number' &&
        Number.isFinite(maxItemsCandidate) &&
        maxItemsCandidate > 0
      ) {
        fanOutStep.maxItems = Math.floor(maxItemsCandidate);
      }

      const maxConcurrencyCandidate = record.maxConcurrency ?? record.max_concurrency;
      if (
        typeof maxConcurrencyCandidate === 'number' &&
        Number.isFinite(maxConcurrencyCandidate) &&
        maxConcurrencyCandidate > 0
      ) {
        fanOutStep.maxConcurrency = Math.floor(maxConcurrencyCandidate);
      }

      const storeResultsAsRaw =
        typeof record.storeResultsAs === 'string'
          ? record.storeResultsAs.trim()
          : typeof (record.store_results_as as unknown) === 'string'
            ? (record.store_results_as as string).trim()
            : '';
      if (storeResultsAsRaw) {
        fanOutStep.storeResultsAs = storeResultsAsRaw;
      }

      seenIds.add(id);
      steps.push(fanOutStep);
      continue;
    }

    const jobStep = parseJobWorkflowStep(record, id, name);
    if (!jobStep) {
      continue;
    }

    seenIds.add(id);
    steps.push(jobStep);
  }
  return steps;
}

const WORKFLOW_RUN_STATUSES: WorkflowRunStatus[] = ['pending', 'running', 'succeeded', 'failed', 'canceled'];

function normalizeWorkflowRunStatus(value: string | null | undefined): WorkflowRunStatus {
  if (!value) {
    return 'pending';
  }
  const normalized = value.trim().toLowerCase();
  const match = WORKFLOW_RUN_STATUSES.find((status) => status === normalized);
  return match ?? 'pending';
}

const WORKFLOW_RUN_STEP_STATUSES: WorkflowRunStepStatus[] = ['pending', 'running', 'succeeded', 'failed', 'skipped'];

function normalizeWorkflowRunStepStatus(value: string | null | undefined): WorkflowRunStepStatus {
  if (!value) {
    return 'pending';
  }
  const normalized = value.trim().toLowerCase();
  const match = WORKFLOW_RUN_STEP_STATUSES.find((status) => status === normalized);
  return match ?? 'pending';
}

export function mapRepositoryRow(
  row: RepositoryRow,
  options: {
    tags?: TagRow[];
    latestBuild?: BuildRow | null;
    latestLaunch?: LaunchRow | null;
    previews?: RepositoryPreviewRow[];
  } = {}
): RepositoryRecord {
  const tags = (options.tags ?? []).map(
    (tag) => ({ key: tag.key, value: tag.value, source: tag.source }) as TagKV
  );

  const launchEnvTemplates = parseLaunchEnv(row.launch_env_templates);

  const previews = (options.previews ?? []).map(mapRepositoryPreviewRow);

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    repoUrl: row.repo_url,
    dockerfilePath: row.dockerfile_path,
    updatedAt: row.updated_at,
    ingestStatus: row.ingest_status as IngestStatus,
    lastIngestedAt: row.last_ingested_at,
    createdAt: row.created_at,
    ingestError: row.ingest_error,
    ingestAttempts: row.ingest_attempts ?? 0,
    tags,
    latestBuild: options.latestBuild ? mapBuildRow(options.latestBuild) : null,
    latestLaunch: options.latestLaunch ? mapLaunchRow(options.latestLaunch) : null,
    previewTiles: previews,
    launchEnvTemplates
  } satisfies RepositoryRecord;
}

export function mapBuildRow(row: BuildRow): BuildRecord {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    status: row.status as BuildStatus,
    logs: row.logs ?? null,
    imageTag: row.image_tag ?? null,
    errorMessage: row.error_message ?? null,
    commitSha: row.commit_sha ?? null,
    gitBranch: row.branch ?? null,
    gitRef: row.git_ref ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    durationMs: row.duration_ms ?? null
  } satisfies BuildRecord;
}

export function mapLaunchRow(row: LaunchRow): LaunchRecord {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    buildId: row.build_id,
    status: row.status as LaunchStatus,
    instanceUrl: row.instance_url ?? null,
    containerId: row.container_id ?? null,
    port: row.port ?? null,
    internalPort: row.internal_port ?? null,
    containerIp: row.container_ip ?? null,
    resourceProfile: row.resource_profile ?? null,
    env: parseLaunchEnv(row.env_vars),
    command: row.command ?? null,
    errorMessage: row.error_message ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? null,
    stoppedAt: row.stopped_at ?? null,
    expiresAt: row.expires_at ?? null
  } satisfies LaunchRecord;
}

export function mapRepositoryPreviewRow(row: RepositoryPreviewRow): RepositoryPreview {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    kind: row.kind as RepositoryPreviewKind,
    source: row.source,
    title: row.title,
    description: row.description,
    src: row.src,
    embedUrl: row.embed_url,
    posterUrl: row.poster_url,
    width: row.width ?? null,
    height: row.height ?? null,
    sortOrder: row.sort_order,
    createdAt: row.created_at
  } satisfies RepositoryPreview;
}

export function mapIngestionEventRow(row: IngestionEventRow): IngestionEvent {
  return {
    id: row.id,
    repositoryId: row.repository_id,
    status: row.status as IngestStatus,
    message: row.message,
    attempt: row.attempt,
    commitSha: row.commit_sha,
    durationMs: row.duration_ms,
    createdAt: row.created_at
  } satisfies IngestionEvent;
}

export function mapServiceNetworkMemberRow(row: ServiceNetworkMemberRow): ServiceNetworkMemberRecord {
  return {
    networkRepositoryId: row.network_repository_id,
    memberRepositoryId: row.member_repository_id,
    launchOrder: row.launch_order ?? 0,
    waitForBuild: Boolean(row.wait_for_build),
    env: parseManifestEnv(row.env_vars),
    dependsOn: parseStringArray(row.depends_on),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } satisfies ServiceNetworkMemberRecord;
}

export function mapServiceNetworkRow(
  row: ServiceNetworkRow,
  members: ServiceNetworkMemberRow[] = []
): ServiceNetworkRecord {
  return {
    repositoryId: row.repository_id,
    manifestSource: row.manifest_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    members: members.map(mapServiceNetworkMemberRow)
  } satisfies ServiceNetworkRecord;
}

export function mapServiceNetworkLaunchMemberRow(
  row: ServiceNetworkLaunchMemberRow
): ServiceNetworkLaunchMemberRecord {
  return {
    networkLaunchId: row.network_launch_id,
    memberLaunchId: row.member_launch_id,
    memberRepositoryId: row.member_repository_id,
    launchOrder: row.launch_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } satisfies ServiceNetworkLaunchMemberRecord;
}

export function mapJobDefinitionRow(row: JobDefinitionRow): JobDefinitionRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    version: row.version,
    type: row.type as JobType,
    entryPoint: row.entry_point,
    parametersSchema: ensureJsonObject(row.parameters_schema),
    defaultParameters: ensureJsonObject(row.default_parameters),
    timeoutMs: row.timeout_ms ?? null,
    retryPolicy: (toJsonObjectOrNull(row.retry_policy) as JobRetryPolicy | null) ?? null,
    metadata: toJsonValue(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } satisfies JobDefinitionRecord;
}

export function mapJobRunRow(row: JobRunRow): JobRunRecord {
  return {
    id: row.id,
    jobDefinitionId: row.job_definition_id,
    status: row.status as JobRunStatus,
    parameters: ensureJsonValue(row.parameters, {}),
    result: toJsonValue(row.result),
    errorMessage: row.error_message ?? null,
    logsUrl: row.logs_url ?? null,
    metrics: toJsonValue(row.metrics),
    context: toJsonValue(row.context),
    timeoutMs: row.timeout_ms ?? null,
    attempt: row.attempt ?? 1,
    maxAttempts: row.max_attempts ?? null,
    durationMs: row.duration_ms ?? null,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } satisfies JobRunRecord;
}

function parseCapabilityFlags(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : null))
      .filter((entry): entry is string => Boolean(entry));
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseCapabilityFlags(parsed);
    } catch {
      return value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }
  }
  return [];
}

function normalizeJobBundleStorageKind(value: string): JobBundleStorageKind {
  if (value === 's3') {
    return 's3';
  }
  return 'local';
}

function normalizeJobBundleVersionStatus(value: string): JobBundleVersionStatus {
  if (value === 'deprecated') {
    return 'deprecated';
  }
  return 'published';
}

function parseNumericValue(value: string | number | null): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mapJobBundleRow(row: JobBundleRow): JobBundleRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    description: row.description ?? null,
    latestVersion: row.latest_version ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } satisfies JobBundleRecord;
}

export function mapJobBundleVersionRow(row: JobBundleVersionRow): JobBundleVersionRecord {
  return {
    id: row.id,
    bundleId: row.bundle_id,
    slug: row.slug,
    version: row.version,
    manifest: ensureJsonObject(row.manifest),
    checksum: row.checksum,
    capabilityFlags: parseCapabilityFlags(row.capability_flags),
    artifactStorage: normalizeJobBundleStorageKind(row.artifact_storage),
    artifactPath: row.artifact_path,
    artifactContentType: row.artifact_content_type ?? null,
    artifactSize: parseNumericValue(row.artifact_size),
    immutable: Boolean(row.immutable),
    status: normalizeJobBundleVersionStatus(row.status),
    publishedBy: row.published_by ?? null,
    publishedByKind: row.published_by_kind ?? null,
    publishedByTokenHash: row.published_by_token_hash ?? null,
    publishedAt: row.published_at,
    deprecatedAt: row.deprecated_at ?? null,
    metadata: toJsonObjectOrNull(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } satisfies JobBundleVersionRecord;
}

function parseJsonColumn(value: unknown): JsonValue | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') {
    return value as JsonValue;
  }
  return null;
}

export function mapServiceRow(row: ServiceRow): ServiceRecord {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    kind: row.kind,
    baseUrl: row.base_url,
    status: row.status as ServiceRecord['status'],
    statusMessage: row.status_message ?? null,
    capabilities: parseJsonColumn(row.capabilities),
    metadata: parseJsonColumn(row.metadata),
    lastHealthyAt: row.last_healthy_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } satisfies ServiceRecord;
}

export function mapWorkflowDefinitionRow(row: WorkflowDefinitionRow): WorkflowDefinitionRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    version: row.version,
    description: row.description,
    steps: parseWorkflowSteps(row.steps),
    triggers: parseWorkflowTriggers(row.triggers),
    parametersSchema: ensureJsonObject(row.parameters_schema),
    defaultParameters: ensureJsonValue(row.default_parameters, {} as JsonValue),
    metadata: toJsonObjectOrNull(row.metadata),
    dag: parseWorkflowDag(row.dag),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } satisfies WorkflowDefinitionRecord;
}

export function mapWorkflowRunRow(row: WorkflowRunRow): WorkflowRunRecord {
  return {
    id: row.id,
    workflowDefinitionId: row.workflow_definition_id,
    status: normalizeWorkflowRunStatus(row.status),
    parameters: ensureJsonValue(row.parameters, {} as JsonValue),
    context: ensureJsonValue(row.context, {} as JsonValue),
    errorMessage: row.error_message,
    currentStepId: row.current_step_id,
    currentStepIndex: row.current_step_index,
    metrics: toJsonValue(row.metrics),
    triggeredBy: row.triggered_by,
    trigger: toJsonValue(row.trigger),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } satisfies WorkflowRunRecord;
}

export function mapWorkflowRunStepRow(row: WorkflowRunStepRow): WorkflowRunStepRecord {
  return {
    id: row.id,
    workflowRunId: row.workflow_run_id,
    stepId: row.step_id,
    status: normalizeWorkflowRunStepStatus(row.status),
    attempt: row.attempt,
    jobRunId: row.job_run_id,
    input: toJsonValue(row.input),
    output: toJsonValue(row.output),
    errorMessage: row.error_message,
    logsUrl: row.logs_url,
    metrics: toJsonValue(row.metrics),
    context: toJsonValue(row.context),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    parentStepId: row.parent_step_id,
    fanoutIndex: row.fanout_index,
    templateStepId: row.template_step_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } satisfies WorkflowRunStepRecord;
}
