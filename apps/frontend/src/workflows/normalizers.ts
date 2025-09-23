import type {
  WorkflowAssetDetail,
  WorkflowAssetInventoryEntry,
  WorkflowAssetRoleDescriptor,
  WorkflowAssetSnapshot,
  WorkflowDefinition,
  WorkflowFanOutTemplateStep,
  WorkflowFiltersState,
  WorkflowRun,
  WorkflowRunMetricsSummary,
  WorkflowRunStatsSummary,
  WorkflowRunStep,
  WorkflowRuntimeSummary
} from './types';

export type WorkflowSummary = {
  workflow: WorkflowDefinition;
  status: string;
  repos: string[];
  services: string[];
  tags: string[];
  runtime: WorkflowRuntimeSummary | undefined;
};

export function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry): entry is string => entry.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeFanOutTemplate(raw: unknown): WorkflowFanOutTemplateStep | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const template = raw as Record<string, unknown>;
  const id = typeof template.id === 'string' ? template.id : null;
  const name = typeof template.name === 'string' ? template.name : null;
  if (!id || !name) {
    return null;
  }
  const jobSlug = typeof template.jobSlug === 'string' ? template.jobSlug : undefined;
  const serviceSlug = typeof template.serviceSlug === 'string' ? template.serviceSlug : undefined;
  const rawType = typeof template.type === 'string' ? template.type.toLowerCase() : null;
  const normalizedType: WorkflowFanOutTemplateStep['type'] =
    rawType === 'service'
      ? 'service'
      : rawType === 'job'
        ? 'job'
        : serviceSlug
          ? 'service'
          : 'job';

  return {
    id,
    name,
    type: normalizedType,
    jobSlug,
    serviceSlug,
    description:
      typeof template.description === 'string'
        ? template.description
        : template.description === null
          ? null
          : undefined,
    dependsOn: normalizeStringArray(template.dependsOn),
    parameters: 'parameters' in template ? template.parameters : undefined,
    timeoutMs:
      typeof template.timeoutMs === 'number'
        ? template.timeoutMs
        : template.timeoutMs === null
          ? null
          : undefined,
    retryPolicy: 'retryPolicy' in template ? template.retryPolicy : undefined,
    storeResultAs: typeof template.storeResultAs === 'string' ? template.storeResultAs : undefined,
    requireHealthy: typeof template.requireHealthy === 'boolean' ? template.requireHealthy : undefined,
    allowDegraded: typeof template.allowDegraded === 'boolean' ? template.allowDegraded : undefined,
    captureResponse: typeof template.captureResponse === 'boolean' ? template.captureResponse : undefined,
    storeResponseAs: typeof template.storeResponseAs === 'string' ? template.storeResponseAs : undefined,
    request: 'request' in template ? template.request : undefined
  } satisfies WorkflowFanOutTemplateStep;
}

export function normalizeWorkflowDefinition(payload: unknown): WorkflowDefinition | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const slug = typeof raw.slug === 'string' ? raw.slug : null;
  const name = typeof raw.name === 'string' ? raw.name : null;
  if (!id || !slug || !name) {
    return null;
  }

  const steps: WorkflowDefinition['steps'] = [];
  if (Array.isArray(raw.steps)) {
    for (const entry of raw.steps) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const step = entry as Record<string, unknown>;
      const stepId = typeof step.id === 'string' ? step.id : null;
      const stepName = typeof step.name === 'string' ? step.name : null;
      if (!stepId || !stepName) {
        continue;
      }
      const jobSlug = typeof step.jobSlug === 'string' ? step.jobSlug : undefined;
      const serviceSlug = typeof step.serviceSlug === 'string' ? step.serviceSlug : undefined;
      const rawType = typeof step.type === 'string' ? step.type.toLowerCase() : null;
      const description =
        typeof step.description === 'string'
          ? step.description
          : step.description === null
            ? null
            : undefined;
      const dependsOn = normalizeStringArray(step.dependsOn);
      const dependents = normalizeStringArray(step.dependents);

      if (rawType === 'fanout') {
        const fanOutStep = {
          id: stepId,
          name: stepName,
          type: 'fanout' as const,
          description,
          dependsOn,
          dependents,
          collection: 'collection' in step ? step.collection : undefined,
          template: normalizeFanOutTemplate(step.template),
          maxItems:
            typeof step.maxItems === 'number'
              ? step.maxItems
              : step.maxItems === null
                ? null
                : undefined,
          maxConcurrency:
            typeof step.maxConcurrency === 'number'
              ? step.maxConcurrency
              : step.maxConcurrency === null
                ? null
                : undefined,
          storeResultsAs: typeof step.storeResultsAs === 'string' ? step.storeResultsAs : undefined
        } satisfies WorkflowDefinition['steps'][number];
        steps.push(fanOutStep);
        continue;
      }

      const stepType =
        rawType === 'service'
          ? 'service'
          : rawType === 'job'
            ? 'job'
            : serviceSlug
              ? 'service'
              : 'job';

      const normalizedStep = {
        id: stepId,
        name: stepName,
        type: stepType,
        jobSlug,
        serviceSlug,
        description,
        dependsOn,
        dependents,
        parameters: 'parameters' in step ? step.parameters : undefined,
        timeoutMs:
          typeof step.timeoutMs === 'number'
            ? step.timeoutMs
            : step.timeoutMs === null
              ? null
              : undefined,
        retryPolicy: 'retryPolicy' in step ? step.retryPolicy : undefined,
        storeResultAs: typeof step.storeResultAs === 'string' ? step.storeResultAs : undefined,
        requireHealthy: typeof step.requireHealthy === 'boolean' ? step.requireHealthy : undefined,
        allowDegraded: typeof step.allowDegraded === 'boolean' ? step.allowDegraded : undefined,
        captureResponse: typeof step.captureResponse === 'boolean' ? step.captureResponse : undefined,
        storeResponseAs: typeof step.storeResponseAs === 'string' ? step.storeResponseAs : undefined,
        request: 'request' in step ? step.request : undefined
      } satisfies WorkflowDefinition['steps'][number];
      steps.push(normalizedStep);
    }
  }

  const triggers: WorkflowDefinition['triggers'] = [];
  if (Array.isArray(raw.triggers)) {
    for (const entry of raw.triggers) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const trigger = entry as Record<string, unknown>;
      const type = typeof trigger.type === 'string' ? trigger.type : null;
      if (!type) {
        continue;
      }
      triggers.push({
        type,
        options: 'options' in trigger ? trigger.options : undefined
      });
    }
  }

  return {
    id,
    slug,
    name,
    description: typeof raw.description === 'string' ? raw.description : null,
    version: typeof raw.version === 'number' ? raw.version : 1,
    steps,
    triggers,
    parametersSchema: raw.parametersSchema ?? null,
    defaultParameters: raw.defaultParameters ?? null,
    outputSchema: raw.outputSchema ?? null,
    metadata: raw.metadata ?? null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : ''
  };
}

function normalizeStatusCounts(value: unknown): Record<string, number> {
  const record = toRecord(value);
  if (!record) {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record)) {
    if (!key) {
      continue;
    }
    const count = typeof raw === 'number' ? raw : Number(raw ?? 0);
    if (Number.isFinite(count)) {
      result[key.toLowerCase()] = count;
    }
  }
  return result;
}

export function normalizeWorkflowRunStats(payload: unknown): WorkflowRunStatsSummary | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const workflowId = typeof raw.workflowId === 'string' ? raw.workflowId : null;
  const slug = typeof raw.slug === 'string' ? raw.slug : null;
  const rangeRaw = toRecord(raw.range);
  const rangeFrom = typeof rangeRaw?.from === 'string' ? rangeRaw.from : null;
  const rangeTo = typeof rangeRaw?.to === 'string' ? rangeRaw.to : null;
  const rangeKey = typeof rangeRaw?.key === 'string' ? rangeRaw.key : 'custom';
  if (!workflowId || !slug || !rangeFrom || !rangeTo) {
    return null;
  }
  const totalRunsRaw = typeof raw.totalRuns === 'number' ? raw.totalRuns : Number(raw.totalRuns ?? 0);
  const successRate = typeof raw.successRate === 'number' ? raw.successRate : 0;
  const failureRate = typeof raw.failureRate === 'number' ? raw.failureRate : 0;
  const averageDurationMs =
    typeof raw.averageDurationMs === 'number'
      ? raw.averageDurationMs
      : raw.averageDurationMs === null
        ? null
        : typeof raw.averageDurationMs === 'string'
          ? Number(raw.averageDurationMs)
          : null;
  const failureCategories: WorkflowRunStatsSummary['failureCategories'] = Array.isArray(
    raw.failureCategories
  )
    ? (raw.failureCategories as unknown[])
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          const item = entry as Record<string, unknown>;
          const category = typeof item.category === 'string' ? item.category : null;
          const count =
            typeof item.count === 'number' ? item.count : Number.isFinite(Number(item.count)) ? Number(item.count) : null;
          if (!category || count === null) {
            return null;
          }
          return { category, count };
        })
        .filter((entry): entry is { category: string; count: number } => Boolean(entry))
    : [];

  return {
    workflowId,
    slug,
    range: { from: rangeFrom, to: rangeTo, key: rangeKey },
    totalRuns: Number.isFinite(totalRunsRaw) ? totalRunsRaw : 0,
    statusCounts: normalizeStatusCounts(raw.statusCounts),
    successRate,
    failureRate,
    averageDurationMs: Number.isFinite(averageDurationMs ?? NaN) ? averageDurationMs : null,
    failureCategories
  } satisfies WorkflowRunStatsSummary;
}

export function normalizeWorkflowRunMetrics(payload: unknown): WorkflowRunMetricsSummary | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const workflowId = typeof raw.workflowId === 'string' ? raw.workflowId : null;
  const slug = typeof raw.slug === 'string' ? raw.slug : null;
  const rangeRaw = toRecord(raw.range);
  const rangeFrom = typeof rangeRaw?.from === 'string' ? rangeRaw.from : null;
  const rangeTo = typeof rangeRaw?.to === 'string' ? rangeRaw.to : null;
  const rangeKey = typeof rangeRaw?.key === 'string' ? rangeRaw.key : 'custom';
  if (!workflowId || !slug || !rangeFrom || !rangeTo) {
    return null;
  }

  const bucketInterval = typeof raw.bucketInterval === 'string' ? raw.bucketInterval : '1 hour';
  const bucketRecord = toRecord(raw.bucket);
  const bucket = bucketRecord
    ? {
        interval: typeof bucketRecord.interval === 'string' ? bucketRecord.interval : bucketInterval,
        key:
          typeof bucketRecord.key === 'string'
            ? bucketRecord.key
            : bucketRecord.key === null
              ? null
              : null
      }
    : undefined;

  const series: WorkflowRunMetricsSummary['series'] = Array.isArray(raw.series)
    ? (raw.series as unknown[])
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          const point = entry as Record<string, unknown>;
          const bucketStart = typeof point.bucketStart === 'string' ? point.bucketStart : null;
          const bucketEnd = typeof point.bucketEnd === 'string' ? point.bucketEnd : null;
          if (!bucketStart || !bucketEnd) {
            return null;
          }
          const totalRuns =
            typeof point.totalRuns === 'number'
              ? point.totalRuns
              : Number.isFinite(Number(point.totalRuns))
                ? Number(point.totalRuns)
                : 0;
          const averageDurationMs =
            typeof point.averageDurationMs === 'number'
              ? point.averageDurationMs
              : point.averageDurationMs === null
                ? null
                : typeof point.averageDurationMs === 'string'
                  ? Number(point.averageDurationMs)
                  : null;
          const rollingSuccessCount =
            typeof point.rollingSuccessCount === 'number'
              ? point.rollingSuccessCount
              : Number.isFinite(Number(point.rollingSuccessCount))
                ? Number(point.rollingSuccessCount)
                : 0;
          return {
            bucketStart,
            bucketEnd,
            totalRuns,
            statusCounts: normalizeStatusCounts(point.statusCounts),
            averageDurationMs: Number.isFinite(averageDurationMs ?? NaN) ? averageDurationMs : null,
            rollingSuccessCount
          } satisfies WorkflowRunMetricsSummary['series'][number];
        })
        .filter((entry): entry is WorkflowRunMetricsSummary['series'][number] => Boolean(entry))
    : [];

  return {
    workflowId,
    slug,
    range: { from: rangeFrom, to: rangeTo, key: rangeKey },
    bucketInterval,
    bucket,
    series
  } satisfies WorkflowRunMetricsSummary;
}

export function normalizeWorkflowRun(payload: unknown): WorkflowRun | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const workflowDefinitionId =
    typeof raw.workflowDefinitionId === 'string' ? raw.workflowDefinitionId : null;
  const status = typeof raw.status === 'string' ? raw.status : null;
  if (!id || !workflowDefinitionId || !status) {
    return null;
  }
  return {
    id,
    workflowDefinitionId,
    status,
    currentStepId: typeof raw.currentStepId === 'string' ? raw.currentStepId : null,
    currentStepIndex: typeof raw.currentStepIndex === 'number' ? raw.currentStepIndex : null,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
    durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : null,
    errorMessage:
      typeof raw.errorMessage === 'string'
        ? raw.errorMessage
        : raw.errorMessage === null
          ? null
          : null,
    triggeredBy:
      typeof raw.triggeredBy === 'string'
        ? raw.triggeredBy
        : raw.triggeredBy === null
          ? null
          : null,
    metrics:
      raw.metrics && typeof raw.metrics === 'object' && !Array.isArray(raw.metrics)
        ? (raw.metrics as { totalSteps?: number; completedSteps?: number })
        : null,
    parameters: raw.parameters ?? null,
    context: raw.context ?? null,
    output: raw.output ?? null,
    trigger: raw.trigger ?? null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : ''
  };
}

export function normalizeWorkflowRunStep(payload: unknown): WorkflowRunStep | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : null;
  const workflowRunId = typeof raw.workflowRunId === 'string' ? raw.workflowRunId : null;
  const stepId = typeof raw.stepId === 'string' ? raw.stepId : null;
  const status = typeof raw.status === 'string' ? raw.status : null;
  const attempt = typeof raw.attempt === 'number' ? raw.attempt : null;
  if (!id || !workflowRunId || !stepId || attempt === null || !status) {
    return null;
  }
  return {
    id,
    workflowRunId,
    stepId,
    status,
    attempt,
    jobRunId: typeof raw.jobRunId === 'string' ? raw.jobRunId : null,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
    errorMessage:
      typeof raw.errorMessage === 'string'
        ? raw.errorMessage
        : raw.errorMessage === null
          ? null
          : null,
    logsUrl: typeof raw.logsUrl === 'string' ? raw.logsUrl : null,
    parameters: 'parameters' in raw ? raw.parameters : undefined,
    result: 'result' in raw ? raw.result : undefined,
    metrics: 'metrics' in raw ? raw.metrics : undefined,
    input: 'input' in raw ? raw.input : undefined,
    output: 'output' in raw ? raw.output : undefined,
    context: 'context' in raw ? raw.context : undefined,
    parentStepId:
      typeof raw.parentStepId === 'string'
        ? raw.parentStepId
        : raw.parentStepId === null
          ? null
          : null,
    fanoutIndex:
      typeof raw.fanoutIndex === 'number'
        ? raw.fanoutIndex
        : raw.fanoutIndex === null
          ? null
          : null,
    templateStepId:
      typeof raw.templateStepId === 'string'
        ? raw.templateStepId
        : raw.templateStepId === null
          ? null
          : null
  };
}

function getTimestamp(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function sortRuns(runs: WorkflowRun[]): WorkflowRun[] {
  return runs
    .slice()
    .sort((a, b) => {
      const createdDiff = getTimestamp(b.createdAt) - getTimestamp(a.createdAt);
      if (createdDiff !== 0) {
        return createdDiff;
      }
      const startedDiff = getTimestamp(b.startedAt) - getTimestamp(a.startedAt);
      if (startedDiff !== 0) {
        return startedDiff;
      }
      return getTimestamp(b.updatedAt) - getTimestamp(a.updatedAt);
    });
}

export function summarizeWorkflowMetadata(workflow: WorkflowDefinition) {
  const metadata = toRecord(workflow.metadata);
  const repos = new Set<string>();
  const services = new Set<string>();
  const tags = new Set<string>();
  let status: string | undefined;

  const addString = (value: unknown, target: Set<string>) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      target.add(value.trim());
    }
  };

  if (metadata) {
    addString(metadata.repo, repos);
    addString(metadata.repository, repos);
    addString(metadata.repositoryUrl, repos);
    addString(metadata.repoUrl, repos);
    const source = toRecord(metadata.source);
    if (source) {
      addString(source.repo, repos);
      addString(source.repository, repos);
      addString(source.repositoryUrl, repos);
    }

    const tagsField = metadata.tags;
    if (typeof tagsField === 'string') {
      addString(tagsField, tags);
    } else if (Array.isArray(tagsField)) {
      for (const entry of tagsField) {
        if (typeof entry === 'string') {
          addString(entry, tags);
          continue;
        }
        const record = toRecord(entry);
        if (!record) {
          continue;
        }
        const key = typeof record.key === 'string' ? record.key : undefined;
        const value = typeof record.value === 'string' ? record.value : undefined;
        if (key && value) {
          tags.add(`${key}:${value}`);
        } else if (key) {
          tags.add(key);
        } else if (value) {
          tags.add(value);
        }
      }
    }

    const statusValue = metadata.status ?? metadata.latestStatus ?? metadata.state;
    if (typeof statusValue === 'string') {
      status = statusValue;
    }

    const serviceMeta = metadata.service ?? metadata.workflowService ?? metadata.targetService;
    addString(serviceMeta, services);
    if (typeof metadata.services === 'string') {
      addString(metadata.services, services);
    } else if (Array.isArray(metadata.services)) {
      for (const value of metadata.services) {
        addString(value, services);
      }
    }

    if (Array.isArray(metadata.stepSummaries)) {
      for (const entry of metadata.stepSummaries) {
        const record = toRecord(entry);
        if (!record) {
          continue;
        }
        addString(record.repo, repos);
        addString(record.service, services);
        addString(record.tag, tags);
      }
    }
  }

  for (const step of workflow.steps) {
    if (step.serviceSlug) {
      services.add(step.serviceSlug);
    }
  }

  return {
    repos: Array.from(repos),
    services: Array.from(services),
    tags: Array.from(tags),
    status: status ?? 'unknown'
  } satisfies Pick<WorkflowSummary, 'repos' | 'services' | 'tags' | 'status'>;
}

function normalizeAssetFreshnessValue(value: unknown): WorkflowAssetRoleDescriptor['freshness'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const freshness: WorkflowAssetRoleDescriptor['freshness'] = {};
  if (typeof record.maxAgeMs === 'number' && Number.isFinite(record.maxAgeMs)) {
    freshness.maxAgeMs = record.maxAgeMs;
  }
  if (typeof record.ttlMs === 'number' && Number.isFinite(record.ttlMs)) {
    freshness.ttlMs = record.ttlMs;
  }
  if (typeof record.cadenceMs === 'number' && Number.isFinite(record.cadenceMs)) {
    freshness.cadenceMs = record.cadenceMs;
  }
  return Object.keys(freshness).length > 0 ? freshness : null;
}

function normalizeAssetRoleDescriptor(raw: unknown): WorkflowAssetRoleDescriptor | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const stepId = typeof record.stepId === 'string' ? record.stepId : null;
  if (!stepId) {
    return null;
  }
  const stepName = typeof record.stepName === 'string' ? record.stepName : stepId;
  const rawType = typeof record.stepType === 'string' ? record.stepType.toLowerCase() : null;
  const stepType: WorkflowAssetRoleDescriptor['stepType'] =
    rawType === 'service' ? 'service' : rawType === 'fanout' ? 'fanout' : 'job';

  return {
    stepId,
    stepName,
    stepType,
    schema: 'schema' in record ? record.schema : null,
    freshness: normalizeAssetFreshnessValue(record.freshness)
  };
}

function normalizeAssetSnapshot(raw: unknown): WorkflowAssetSnapshot | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }
  const runId = typeof record.runId === 'string' ? record.runId : null;
  const stepId = typeof record.stepId === 'string' ? record.stepId : null;
  const producedAt = typeof record.producedAt === 'string' ? record.producedAt : null;
  if (!runId || !stepId || !producedAt) {
    return null;
  }
  const runStatus = typeof record.runStatus === 'string' ? record.runStatus : 'unknown';
  const stepStatus = typeof record.stepStatus === 'string' ? record.stepStatus : 'unknown';
  const stepName = typeof record.stepName === 'string' ? record.stepName : stepId;
  const rawType = typeof record.stepType === 'string' ? record.stepType.toLowerCase() : null;
  const stepType: WorkflowAssetSnapshot['stepType'] =
    rawType === 'service' ? 'service' : rawType === 'fanout' ? 'fanout' : 'job';

  return {
    runId,
    runStatus,
    stepId,
    stepName,
    stepType,
    stepStatus,
    producedAt,
    payload: 'payload' in record ? record.payload : null,
    schema: 'schema' in record ? record.schema : null,
    freshness: normalizeAssetFreshnessValue(record.freshness),
    runStartedAt: typeof record.runStartedAt === 'string' ? record.runStartedAt : null,
    runCompletedAt: typeof record.runCompletedAt === 'string' ? record.runCompletedAt : null
  };
}

export function normalizeWorkflowAssetInventoryResponse(payload: unknown): WorkflowAssetInventoryEntry[] {
  const root = toRecord(payload);
  if (!root) {
    return [];
  }
  const data = toRecord(root.data);
  if (!data) {
    return [];
  }
  const entries = Array.isArray(data.assets) ? data.assets : [];
  const normalized: WorkflowAssetInventoryEntry[] = [];
  for (const entry of entries) {
    const record = toRecord(entry);
    if (!record) {
      continue;
    }
    const assetId = typeof record.assetId === 'string' ? record.assetId : '';
    if (!assetId) {
      continue;
    }
    const producers = Array.isArray(record.producers)
      ? record.producers
          .map(normalizeAssetRoleDescriptor)
          .filter((value): value is WorkflowAssetRoleDescriptor => Boolean(value))
      : [];
    const consumers = Array.isArray(record.consumers)
      ? record.consumers
          .map(normalizeAssetRoleDescriptor)
          .filter((value): value is WorkflowAssetRoleDescriptor => Boolean(value))
      : [];
    const latest = 'latest' in record ? normalizeAssetSnapshot(record.latest) : null;
    const available = Boolean(record.available);
    normalized.push({ assetId, producers, consumers, latest, available });
  }
  return normalized;
}

export function normalizeWorkflowAssetDetailResponse(payload: unknown): WorkflowAssetDetail | null {
  const root = toRecord(payload);
  if (!root) {
    return null;
  }
  const data = toRecord(root.data);
  if (!data) {
    return null;
  }
  const assetId = typeof data.assetId === 'string' ? data.assetId : null;
  if (!assetId) {
    return null;
  }
  const producers = Array.isArray(data.producers)
    ? data.producers
        .map(normalizeAssetRoleDescriptor)
        .filter((value): value is WorkflowAssetRoleDescriptor => Boolean(value))
    : [];
  const consumers = Array.isArray(data.consumers)
    ? data.consumers
        .map(normalizeAssetRoleDescriptor)
        .filter((value): value is WorkflowAssetRoleDescriptor => Boolean(value))
    : [];
  const historyEntries = Array.isArray(data.history) ? data.history : [];
  const history = historyEntries
    .map(normalizeAssetSnapshot)
    .filter((value): value is WorkflowAssetSnapshot => Boolean(value));
  const limit = typeof data.limit === 'number' && Number.isFinite(data.limit) ? data.limit : history.length;

  return {
    assetId,
    producers,
    consumers,
    history,
    limit
  };
}

export function buildFilterOptions(values: string[]): Array<{ value: string; label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function buildStatusOptions(summaries: WorkflowSummary[]): Array<{ value: string; label: string; count: number }> {
  return buildFilterOptions(summaries.map((summary) => summary.status.toLowerCase())).map((option) => ({
    ...option,
    label: option.label.toUpperCase()
  }));
}

export function filterSummaries(
  summaries: WorkflowSummary[],
  filters: WorkflowFiltersState,
  searchTerm: string
): WorkflowSummary[] {
  const normalizedSearch = searchTerm.trim().toLowerCase();
  return summaries.filter((summary) => {
    if (filters.statuses.length > 0 && !filters.statuses.includes(summary.status.toLowerCase())) {
      return false;
    }
    if (filters.repos.length > 0 && summary.repos.every((repo) => !filters.repos.includes(repo))) {
      return false;
    }
    if (filters.services.length > 0 && summary.services.every((service) => !filters.services.includes(service))) {
      return false;
    }
    if (filters.tags.length > 0 && summary.tags.every((tag) => !filters.tags.includes(tag))) {
      return false;
    }
    if (!normalizedSearch) {
      return true;
    }
    const haystacks = [
      summary.workflow.name,
      summary.workflow.slug,
      summary.workflow.description ?? '',
      summary.status,
      ...summary.repos,
      ...summary.services,
      ...summary.tags
    ]
      .filter(Boolean)
      .map((value) => value.toLowerCase());
    return haystacks.some((text) => text.includes(normalizedSearch));
  });
}
