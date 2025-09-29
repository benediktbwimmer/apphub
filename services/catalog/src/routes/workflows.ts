import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createWorkflowDefinition,
  createWorkflowRun,
  getWorkflowDefinitionBySlug,
  getWorkflowRunById,
  getWorkflowRunMetricsBySlug,
  getWorkflowRunStatsBySlug,
  listWorkflowDefinitions,
  listWorkflowRunSteps,
  listWorkflowRuns,
  listWorkflowRunsForDefinition,
  listWorkflowRunsInRange,
  listWorkflowAutoRunsForDefinition,
  updateWorkflowDefinition,
  updateWorkflowRun,
  getJobDefinitionsBySlugs,
  listWorkflowAssetDeclarationsBySlug,
  listLatestWorkflowAssetSnapshots,
  listWorkflowAssetHistory,
  listWorkflowAssetPartitions,
  getWorkflowAssetPartitionParameters,
  setWorkflowAssetPartitionParameters,
  removeWorkflowAssetPartitionParameters,
  listWorkflowSchedulesWithWorkflow,
  createWorkflowSchedule,
  updateWorkflowSchedule,
  deleteWorkflowSchedule,
  getWorkflowScheduleWithWorkflow,
  getWorkflowAutoRunClaim,
  getFailureState as getAutoMaterializeFailureState,
  listWorkflowEventTriggers,
  listWorkflowTriggerDeliveriesForWorkflow,
  listWorkflowEventsByIds,
  listTriggerFailureEvents,
  listTriggerPauseEvents,
  listSourcePauseEvents
} from '../db/index';
import type {
  JobDefinitionRecord,
  JsonValue,
  WorkflowAssetDeclaration,
  WorkflowAssetDeclarationRecord,
  WorkflowAssetSnapshotRecord,
  WorkflowFanOutTemplateDefinition,
  WorkflowJobStepBundle,
  WorkflowJobStepDefinition,
  WorkflowStepDefinition
} from '../db/types';
import {
  applyDagMetadataToSteps,
  buildWorkflowDagMetadata,
  WorkflowDagValidationError
} from '../workflows/dag';
import {
  workflowDefinitionCreateSchema,
  workflowDefinitionUpdateSchema,
  workflowTriggerSchema,
  jsonValueSchema,
  workflowAssetPartitionParametersSchema,
  type WorkflowFanOutTemplateInput,
  type WorkflowStepInput,
  type WorkflowTriggerInput,
  type WorkflowAssetDeclarationInput,
  workflowScheduleCreateSchema,
  workflowScheduleUpdateSchema
} from '../workflows/zodSchemas';
import {
  collectPartitionedAssetsFromSteps,
  enumeratePartitionKeys,
  validatePartitionKey
} from '../workflows/partitioning';
import { parseBundleEntryPoint } from '../jobs/bundleBinding';
import {
  enqueueWorkflowRun
} from '../queue';
import {
  serializeWorkflowDefinition,
  serializeWorkflowSchedule,
  serializeWorkflowRunMetrics,
  serializeWorkflowRun,
  serializeWorkflowRunWithDefinition,
  serializeWorkflowRunStats,
  serializeWorkflowRunStep,
  serializeWorkflowTriggerDelivery,
  serializeWorkflowEvent
} from './shared/serializers';
import { requireOperatorScopes } from './shared/operatorAuth';
import { WORKFLOW_RUN_SCOPES, WORKFLOW_WRITE_SCOPES } from './shared/scopes';
import { registerWorkflowTriggerRoutes } from './workflows/triggers';
import { registerWorkflowGraphRoute } from './workflows/graph';
import { getWorkflowDefaultParameters } from '../bootstrap';

type WorkflowJobStepInput = Extract<WorkflowStepInput, { jobSlug: string }>;
type WorkflowJobTemplateInput = Extract<WorkflowFanOutTemplateInput, { jobSlug: string }>;
type JobDefinitionLookup = Map<string, JobDefinitionRecord>;

type TimelineTriggerSummary = {
  id: string;
  name: string | null;
  eventType: string;
  eventSource: string | null;
  status: string;
};

type WorkflowTimelineRunEntry = {
  kind: 'run';
  id: string;
  timestamp: string;
  run: ReturnType<typeof serializeWorkflowRun>;
};

type WorkflowTimelineTriggerEntry = {
  kind: 'trigger';
  id: string;
  timestamp: string;
  delivery: ReturnType<typeof serializeWorkflowTriggerDelivery>;
  trigger: TimelineTriggerSummary | null;
  event: ReturnType<typeof serializeWorkflowEvent> | null;
};

type WorkflowTimelineSchedulerEntry = {
  kind: 'scheduler';
  id: string;
  timestamp: string;
  category: 'trigger_failure' | 'trigger_paused' | 'source_paused';
  trigger?: TimelineTriggerSummary;
  source?: string;
  reason?: string | null;
  failures?: number;
  until?: string | null;
  details?: JsonValue | null;
};

type WorkflowTimelineEntry =
  | WorkflowTimelineRunEntry
  | WorkflowTimelineTriggerEntry
  | WorkflowTimelineSchedulerEntry;

const toEpochMillis = (value: string | Date | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
};

const compareNullableTimestamps = (next: number | null, current: number | null): number => {
  if (next === null && current === null) {
    return 0;
  }
  if (next === null) {
    return -1;
  }
  if (current === null) {
    return 1;
  }
  if (next > current) {
    return 1;
  }
  if (next < current) {
    return -1;
  }
  return 0;
};

const isNewerAssetSnapshot = (
  current: WorkflowAssetSnapshotRecord,
  candidate: WorkflowAssetSnapshotRecord
): boolean => {
  const producedComparison = compareNullableTimestamps(
    toEpochMillis(candidate.asset.producedAt),
    toEpochMillis(current.asset.producedAt)
  );
  if (producedComparison !== 0) {
    return producedComparison > 0;
  }

  const updatedComparison = compareNullableTimestamps(
    toEpochMillis(candidate.asset.updatedAt),
    toEpochMillis(current.asset.updatedAt)
  );
  if (updatedComparison !== 0) {
    return updatedComparison > 0;
  }

  const createdComparison = compareNullableTimestamps(
    toEpochMillis(candidate.asset.createdAt),
    toEpochMillis(current.asset.createdAt)
  );
  if (createdComparison !== 0) {
    return createdComparison > 0;
  }

  return candidate.workflowRunId > current.workflowRunId;
};

const TRIGGER_DELIVERY_STATUSES = ['pending', 'matched', 'throttled', 'skipped', 'launched', 'failed'] as const;
const TRIGGER_DELIVERY_STATUS_SET = new Set<string>(TRIGGER_DELIVERY_STATUSES);

const TIMELINE_RANGE_ENUM_VALUES = ['1h', '3h', '6h', '12h', '24h', '3d', '7d'] as const;
type TimelineRangePreset = (typeof TIMELINE_RANGE_ENUM_VALUES)[number];

const TIMELINE_RANGE_PRESETS: Record<TimelineRangePreset, number> = {
  '1h': 60 * 60 * 1000,
  '3h': 3 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
};

const DEFAULT_TIMELINE_RANGE: TimelineRangePreset = '24h';
const DEFAULT_TIMELINE_LIMIT = 200;

const coerceTimestamp = (value: string | null | undefined, fallbackIso: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallbackIso;

function normalizeAssetPartitioning(
  partitioning: WorkflowAssetDeclarationInput['partitioning']
): WorkflowAssetDeclaration['partitioning'] | undefined {
  if (!partitioning) {
    return undefined;
  }

  if (partitioning.type === 'static') {
    const keys = Array.from(
      new Set(partitioning.keys.map((key) => key.trim()).filter((key) => key.length > 0))
    );
    if (keys.length === 0) {
      return undefined;
    }
    return {
      type: 'static',
      keys
    } satisfies WorkflowAssetDeclaration['partitioning'];
  }

  if (partitioning.type === 'timeWindow') {
    const timezone = partitioning.timezone?.trim();
    const format = partitioning.format?.trim();
    const normalized: WorkflowAssetDeclaration['partitioning'] = {
      type: 'timeWindow',
      granularity: partitioning.granularity,
      timezone: timezone && timezone.length > 0 ? timezone : undefined,
      format: format && format.length > 0 ? format : undefined,
      lookbackWindows:
        typeof partitioning.lookbackWindows === 'number'
          ? Math.max(1, Math.floor(partitioning.lookbackWindows))
          : undefined
    };
    return normalized;
  }

  if (partitioning.type === 'dynamic') {
    const normalized: WorkflowAssetDeclaration['partitioning'] = { type: 'dynamic' };
    if (typeof partitioning.maxKeys === 'number') {
      normalized.maxKeys = Math.max(1, Math.floor(partitioning.maxKeys));
    }
    if (typeof partitioning.retentionDays === 'number') {
      normalized.retentionDays = Math.max(1, Math.floor(partitioning.retentionDays));
    }
    return normalized;
  }

  return undefined;
}

function buildWorkflowStepMetadata(steps: WorkflowStepDefinition[]) {
  const metadata = new Map<
    string,
    {
      name: string;
      type: WorkflowStepDefinition['type'];
    }
  >();

  for (const step of steps) {
    metadata.set(step.id, {
      name: step.name ?? step.id,
      type: step.type
    });

    if (step.type === 'fanout') {
      const template = step.template;
      metadata.set(template.id, {
        name: template.name ?? template.id,
        type: template.type
      });
    }
  }

  return metadata;
}

function normalizeAssetDeclarations(
  declarations: WorkflowAssetDeclarationInput[] | undefined
): WorkflowAssetDeclaration[] | undefined {
  if (!declarations || declarations.length === 0) {
    return undefined;
  }

  const normalized: WorkflowAssetDeclaration[] = [];
  const seen = new Set<string>();

  for (const declaration of declarations) {
    const assetId = declaration.assetId.trim();
    if (!assetId) {
      continue;
    }
    const key = assetId.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const entry: WorkflowAssetDeclaration = {
      assetId
    };

    if (declaration.schema) {
      entry.schema = declaration.schema;
    }

    if (declaration.freshness) {
      entry.freshness = declaration.freshness;
    }

    if (declaration.autoMaterialize) {
      entry.autoMaterialize = declaration.autoMaterialize;
    }

    const partitioning = normalizeAssetPartitioning(declaration.partitioning);
    if (partitioning) {
      entry.partitioning = partitioning;
    }

    normalized.push(entry);
  }

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeWorkflowDependsOn(dependsOn?: string[]) {
  if (!dependsOn) {
    return undefined;
  }
  const unique = Array.from(new Set(dependsOn.map((id) => id.trim()).filter(Boolean)));
  return unique.length > 0 ? unique : undefined;
}

function collectWorkflowJobSlugs(steps: WorkflowStepInput[]): string[] {
  const slugs = new Set<string>();
  for (const step of steps) {
    if (step.type === 'service') {
      continue;
    }
    if (step.type === 'fanout') {
      const template = step.template;
      if (template.type !== 'service' && typeof template.jobSlug === 'string') {
        const slug = template.jobSlug.trim().toLowerCase();
        if (slug) {
          slugs.add(slug);
        }
      }
      continue;
    }
    if (typeof step.jobSlug === 'string') {
      const slug = step.jobSlug.trim().toLowerCase();
      if (slug) {
        slugs.add(slug);
      }
    }
  }
  return Array.from(slugs);
}

function lookupJobDefinition(
  jobDefinitions: JobDefinitionLookup,
  slug: string | undefined
): JobDefinitionRecord | undefined {
  if (!slug) {
    return undefined;
  }
  return jobDefinitions.get(slug.trim().toLowerCase());
}

function normalizeJobBundle(
  rawBundle: WorkflowJobStepInput['bundle'] | null | undefined,
  jobDefinition: JobDefinitionRecord | undefined
): WorkflowJobStepBundle | null | undefined {
  if (rawBundle === null) {
    return null;
  }
  const parsed = jobDefinition ? parseBundleEntryPoint(jobDefinition.entryPoint) : null;

  if (rawBundle && rawBundle.strategy === 'latest') {
    const slugFromInput = typeof rawBundle.slug === 'string' ? rawBundle.slug.trim().toLowerCase() : '';
    const slug = slugFromInput || parsed?.slug || '';
    if (!slug) {
      return parsed
        ? {
            strategy: 'latest',
            slug: parsed.slug,
            version: null,
            exportName: parsed.exportName ?? null
          }
        : undefined;
    }
    const exportName = rawBundle.exportName ?? parsed?.exportName ?? null;
    return {
      strategy: 'latest',
      slug,
      version: null,
      exportName
    } satisfies WorkflowJobStepBundle;
  }

  if (rawBundle && typeof rawBundle.version === 'string' && rawBundle.version.trim().length > 0) {
    const slugFromInput = typeof rawBundle.slug === 'string' ? rawBundle.slug.trim().toLowerCase() : '';
    const slug = slugFromInput || parsed?.slug || '';
    if (!slug) {
      return parsed
        ? {
            strategy: 'pinned',
            slug: parsed.slug,
            version: rawBundle.version.trim(),
            exportName: rawBundle.exportName ?? parsed.exportName ?? null
          }
        : undefined;
    }
    const exportName = rawBundle.exportName ?? parsed?.exportName ?? null;
    return {
      strategy: 'pinned',
      slug,
      version: rawBundle.version.trim(),
      exportName
    } satisfies WorkflowJobStepBundle;
  }

  if (parsed) {
    return {
      strategy: 'pinned',
      slug: parsed.slug,
      version: parsed.version,
      exportName: parsed.exportName ?? null
    } satisfies WorkflowJobStepBundle;
  }

  return undefined;
}

function normalizeWorkflowJobStep(
  step: WorkflowJobStepInput,
  jobDefinitions: JobDefinitionLookup
): WorkflowJobStepDefinition {
  const base = {
    id: step.id,
    name: step.name,
    description: step.description ?? null,
    dependsOn: normalizeWorkflowDependsOn(step.dependsOn)
  };

  const jobDefinition = lookupJobDefinition(jobDefinitions, step.jobSlug);
  const bundle = normalizeJobBundle(step.bundle ?? undefined, jobDefinition);
  const produces = normalizeAssetDeclarations(step.produces);
  const consumes = normalizeAssetDeclarations(step.consumes);

  const normalized: WorkflowJobStepDefinition = {
    ...base,
    type: 'job',
    jobSlug: step.jobSlug,
    parameters: step.parameters ?? undefined,
    timeoutMs: step.timeoutMs ?? null,
    retryPolicy: step.retryPolicy ?? null,
    storeResultAs: step.storeResultAs ?? undefined
  } satisfies WorkflowJobStepDefinition;

  if (bundle !== undefined) {
    normalized.bundle = bundle;
  }

  if (produces) {
    normalized.produces = produces;
  }

  if (consumes) {
    normalized.consumes = consumes;
  }

  return normalized;
}

function normalizeWorkflowFanOutTemplate(
  template: WorkflowFanOutTemplateInput,
  jobDefinitions: JobDefinitionLookup
) {
  const base = {
    id: template.id,
    name: template.name,
    description: template.description ?? null,
    dependsOn: normalizeWorkflowDependsOn(template.dependsOn)
  };

  if (template.type === 'service') {
    const produces = normalizeAssetDeclarations(template.produces);
    const consumes = normalizeAssetDeclarations(template.consumes);

    const definition: WorkflowFanOutTemplateDefinition = {
      ...base,
      type: 'service' as const,
      serviceSlug: template.serviceSlug.trim().toLowerCase(),
      parameters: template.parameters ?? undefined,
      timeoutMs: template.timeoutMs ?? null,
      retryPolicy: template.retryPolicy ?? null,
      requireHealthy: template.requireHealthy ?? undefined,
      allowDegraded: template.allowDegraded ?? undefined,
      captureResponse: template.captureResponse ?? undefined,
      storeResponseAs: template.storeResponseAs ?? undefined,
      request: template.request
    } satisfies WorkflowFanOutTemplateDefinition;

    if (produces) {
      definition.produces = produces;
    }

    if (consumes) {
      definition.consumes = consumes;
    }

    return definition;
  }

  const jobTemplate = template as WorkflowJobTemplateInput;
  const jobDefinition = lookupJobDefinition(jobDefinitions, jobTemplate.jobSlug);
  const bundle = normalizeJobBundle(jobTemplate.bundle ?? undefined, jobDefinition);
  const produces = normalizeAssetDeclarations(jobTemplate.produces);
  const consumes = normalizeAssetDeclarations(jobTemplate.consumes);

  const normalized: WorkflowFanOutTemplateDefinition = {
    ...base,
    type: 'job',
    jobSlug: jobTemplate.jobSlug,
    parameters: jobTemplate.parameters ?? undefined,
    timeoutMs: jobTemplate.timeoutMs ?? null,
    retryPolicy: jobTemplate.retryPolicy ?? null,
    storeResultAs: jobTemplate.storeResultAs ?? undefined
  } satisfies WorkflowFanOutTemplateDefinition;

  if (bundle !== undefined) {
    normalized.bundle = bundle;
  }

  if (produces) {
    normalized.produces = produces;
  }

  if (consumes) {
    normalized.consumes = consumes;
  }

  return normalized;
}

async function normalizeWorkflowSteps(
  steps: WorkflowStepInput[]
): Promise<WorkflowStepDefinition[]> {
  const jobSlugs = collectWorkflowJobSlugs(steps);
  const jobDefinitions = await getJobDefinitionsBySlugs(jobSlugs);

  return steps.map((step) => {
    if (step.type === 'fanout') {
      const produces = normalizeAssetDeclarations(step.produces);
      const consumes = normalizeAssetDeclarations(step.consumes);

      const definition: WorkflowStepDefinition = {
        id: step.id,
        name: step.name,
        description: step.description ?? null,
        dependsOn: normalizeWorkflowDependsOn(step.dependsOn),
        type: 'fanout' as const,
        collection: step.collection,
        template: normalizeWorkflowFanOutTemplate(step.template, jobDefinitions),
        maxItems: step.maxItems ?? null,
        maxConcurrency: step.maxConcurrency ?? null,
        storeResultsAs: step.storeResultsAs ?? undefined
      } satisfies WorkflowStepDefinition;

      if (produces) {
        definition.produces = produces;
      }

      if (consumes) {
        definition.consumes = consumes;
      }

      return definition;
    }

    if (step.type === 'service') {
      const produces = normalizeAssetDeclarations(step.produces);
      const consumes = normalizeAssetDeclarations(step.consumes);

      const definition: WorkflowStepDefinition = {
        id: step.id,
        name: step.name,
        description: step.description ?? null,
        dependsOn: normalizeWorkflowDependsOn(step.dependsOn),
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
      } satisfies WorkflowStepDefinition;

      if (produces) {
        definition.produces = produces;
      }

      if (consumes) {
        definition.consumes = consumes;
      }

      return definition;
    }

    return normalizeWorkflowJobStep(step as WorkflowJobStepInput, jobDefinitions);
  });
}

function normalizeWorkflowSchedule(schedule?: WorkflowTriggerInput['schedule']) {
  if (!schedule) {
    return undefined;
  }

  const normalized = {
    cron: schedule.cron.trim(),
    timezone: schedule.timezone ? schedule.timezone.trim() : null,
    startWindow: schedule.startWindow ?? null,
    endWindow: schedule.endWindow ?? null,
    catchUp: schedule.catchUp ?? false
  };

  return normalized;
}

function normalizeWorkflowTriggers(triggers?: WorkflowTriggerInput[]) {
  if (!triggers) {
    return undefined;
  }
  return triggers.map((trigger) => {
    const schedule = normalizeWorkflowSchedule(trigger.schedule);
    const type = trigger.type.trim();
    const payload: {
      type: string;
      options: JsonValue | null;
      schedule?: typeof schedule;
    } = {
      type,
      options: (trigger.options ?? null) as JsonValue | null
    };

    if (schedule) {
      payload.schedule = schedule;
    }

    return payload;
  });
}

const ANALYTICS_RANGE_OPTIONS = ['24h', '7d', '30d'] as const;
const ANALYTICS_BUCKET_OPTIONS = ['15m', 'hour', 'day'] as const;

type AnalyticsRangeOption = (typeof ANALYTICS_RANGE_OPTIONS)[number];
type AnalyticsBucketOption = (typeof ANALYTICS_BUCKET_OPTIONS)[number];
type AnalyticsRangeKey = AnalyticsRangeOption | 'custom';

const ANALYTICS_RANGE_HOURS: Record<AnalyticsRangeOption, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30
};

const workflowAnalyticsQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    range: z.enum(ANALYTICS_RANGE_OPTIONS).optional(),
    bucket: z.enum(ANALYTICS_BUCKET_OPTIONS).optional()
  })
  .partial()
  .strict();

type WorkflowAnalyticsQuery = z.infer<typeof workflowAnalyticsQuerySchema>;

type NormalizedAnalyticsQuery = {
  rangeKey: AnalyticsRangeKey;
  bucketKey: AnalyticsBucketOption | null;
  options: { from: Date; to: Date; bucketInterval?: string };
};

const ANALYTICS_ERROR_MESSAGES: Record<string, string> = {
  invalid_from: 'Invalid "from" timestamp',
  invalid_to: 'Invalid "to" timestamp',
  invalid_range: 'The "from" timestamp must be before "to"',
  invalid_bucket: 'Invalid bucket option'
};

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function mapBucketKeyToInterval(bucketKey: AnalyticsBucketOption | null | undefined):
  | { key: AnalyticsBucketOption; interval: string }
  | null {
  if (!bucketKey) {
    return null;
  }
  switch (bucketKey) {
    case '15m':
      return { key: '15m', interval: '15 minutes' };
    case 'hour':
      return { key: 'hour', interval: '1 hour' };
    case 'day':
      return { key: 'day', interval: '1 day' };
    default:
      return null;
  }
}

function mapIntervalToBucketKey(interval: string | null | undefined): AnalyticsBucketOption | null {
  if (!interval) {
    return null;
  }
  switch (interval) {
    case '15 minutes':
      return '15m';
    case '1 hour':
      return 'hour';
    case '1 day':
      return 'day';
    default:
      return null;
  }
}

function normalizeAnalyticsQuery(
  query: WorkflowAnalyticsQuery
): { ok: true; value: NormalizedAnalyticsQuery } | { ok: false; error: string } {
  const toDate = parseIsoDate(query.to);
  if (query.to && !toDate) {
    return { ok: false, error: 'invalid_to' };
  }
  const fromDate = parseIsoDate(query.from);
  if (query.from && !fromDate) {
    return { ok: false, error: 'invalid_from' };
  }

  let rangeKey: AnalyticsRangeKey = query.range ?? '7d';
  let to = toDate ?? new Date();
  let from = fromDate ?? null;

  if (fromDate || toDate) {
    rangeKey = query.range ?? 'custom';
  }

  const effectiveRange: AnalyticsRangeOption =
    rangeKey === 'custom' ? '7d' : (rangeKey as AnalyticsRangeOption);

  if (!from) {
    const hours = ANALYTICS_RANGE_HOURS[effectiveRange] ?? ANALYTICS_RANGE_HOURS['7d'];
    from = new Date(to.getTime() - hours * 60 * 60 * 1000);
  }

  if (from.getTime() >= to.getTime()) {
    return { ok: false, error: 'invalid_range' };
  }

  const bucketConfig = mapBucketKeyToInterval(query.bucket ?? null);
  if (query.bucket && !bucketConfig) {
    return { ok: false, error: 'invalid_bucket' };
  }

  return {
    ok: true,
    value: {
      rangeKey,
      bucketKey: bucketConfig?.key ?? null,
      options: bucketConfig
        ? { from, to, bucketInterval: bucketConfig.interval }
        : { from, to }
    }
  };
}

const workflowRunRequestSchema = z
  .object({
    parameters: jsonValueSchema.optional(),
    triggeredBy: z.string().min(1).max(200).optional(),
    trigger: workflowTriggerSchema.optional(),
    partitionKey: z.string().min(1).max(200).optional()
  })
  .strict();

const stringArrayQuerySchema = z.preprocess((val) => {
  if (Array.isArray(val)) {
    return val
      .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  if (typeof val === 'string') {
    return val
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return undefined;
}, z.array(z.string()).optional());

const workflowRunListQuerySchema = z
  .object({
    limit: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(1).max(50).optional()),
    offset: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(0).optional()),
    status: stringArrayQuerySchema,
    workflow: stringArrayQuerySchema,
    trigger: stringArrayQuerySchema,
    partition: z.string().max(200).optional(),
    search: z.string().max(200).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional()
  })
  .partial();

const workflowTimelineQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    range: z.enum(TIMELINE_RANGE_ENUM_VALUES).optional(),
    limit: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(1).max(500).optional()),
    status: z
      .preprocess((val) => {
        if (Array.isArray(val)) {
          return val.flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []));
        }
        if (typeof val === 'string') {
          return val.split(',');
        }
        return undefined;
      }, z.array(z.string()).optional())
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

const ASSET_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;

const workflowAssetParamSchema = workflowSlugParamSchema.extend({
  assetId: z
    .string()
    .min(1)
    .max(200)
    .regex(ASSET_ID_PATTERN, 'Invalid asset ID')
});

const workflowAssetHistoryQuerySchema = z
  .object({
    limit: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(1).max(100).optional()),
    partitionKey: z.string().min(1).max(200).optional()
  })
  .partial();

const workflowAssetPartitionsQuerySchema = z
  .object({
    lookback: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(1).max(10_000).optional())
  })
  .partial();

const workflowAssetPartitionParamsQuerySchema = z
  .object({
    partitionKey: z.string().min(1).max(200).optional()
  })
  .partial();

const workflowScheduleIdParamSchema = z
  .object({
    scheduleId: z.string().min(1)
  })
  .strict();

export async function registerWorkflowRoutes(app: FastifyInstance): Promise<void> {
  await registerWorkflowTriggerRoutes(app);
  await registerWorkflowGraphRoute(app);

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

  app.get('/workflow-schedules', async (request, reply) => {
    try {
      const schedules = await listWorkflowSchedulesWithWorkflow();
      reply.status(200);
      return {
        data: schedules.map((entry) => ({
          schedule: serializeWorkflowSchedule(entry.schedule),
          workflow: {
            id: entry.workflow.id,
            slug: entry.workflow.slug,
            name: entry.workflow.name
          }
        }))
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to list workflow schedules');
      reply.status(500);
      return { error: 'Failed to list workflow schedules' };
    }
  });

  app.get('/workflow-runs', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflow-runs.list',
      resource: 'workflows',
      requiredScopes: WORKFLOW_RUN_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseQuery = workflowRunListQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        action: 'workflow-runs.list',
        reason: 'invalid_query',
        details: parseQuery.error.flatten()
      });
      return { error: parseQuery.error.flatten() };
    }

    const limit = Math.min(Math.max(parseQuery.data.limit ?? 20, 1), 50);
    const offset = Math.max(parseQuery.data.offset ?? 0, 0);
    const filters = {
      statuses: parseQuery.data.status,
      workflowSlugs: parseQuery.data.workflow,
      triggerTypes: parseQuery.data.trigger,
      partition: parseQuery.data.partition,
      search: parseQuery.data.search,
      from: parseQuery.data.from,
      to: parseQuery.data.to
    };
    const { items, hasMore } = await listWorkflowRuns({ limit, offset, filters });

    reply.status(200);
    await authResult.auth.log('succeeded', {
      action: 'workflow-runs.list',
      count: items.length,
      limit,
      offset,
      hasMore
    });
    return {
      data: items.map((entry) => serializeWorkflowRunWithDefinition(entry)),
      meta: {
        limit,
        offset,
        hasMore,
        nextOffset: hasMore ? offset + limit : null
      }
    };
  });

  app.post('/workflows', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflows.create',
      resource: 'workflows',
      requiredScopes: WORKFLOW_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseBody = workflowDefinitionCreateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten() });
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const moduleDefaults = getWorkflowDefaultParameters(payload.slug);
    if (moduleDefaults) {
      const existingDefaults =
        payload.defaultParameters && typeof payload.defaultParameters === 'object' && !Array.isArray(payload.defaultParameters)
          ? { ...(payload.defaultParameters as Record<string, JsonValue>) }
          : {};
      for (const [key, value] of Object.entries(moduleDefaults)) {
        existingDefaults[key] = value;
      }
      payload.defaultParameters = existingDefaults;
    }
    const normalizedSteps = await normalizeWorkflowSteps(payload.steps);
    const triggers = normalizeWorkflowTriggers(payload.triggers);

    let dagMetadata: ReturnType<typeof buildWorkflowDagMetadata>;
    let stepsWithDag: WorkflowStepDefinition[];
    try {
      dagMetadata = buildWorkflowDagMetadata(normalizedSteps);
      stepsWithDag = applyDagMetadataToSteps(normalizedSteps, dagMetadata) as WorkflowStepDefinition[];
    } catch (err) {
      if (err instanceof WorkflowDagValidationError) {
        reply.status(400);
        await authResult.auth.log('failed', {
          reason: 'invalid_dag',
          message: err.message,
          detail: err.detail
        });
        return {
          error: {
            message: err.message,
            reason: err.reason,
            detail: err.detail
          }
        };
      }
      throw err;
    }

    try {
      const workflow = await createWorkflowDefinition({
        slug: payload.slug,
        name: payload.name,
        version: payload.version,
        description: payload.description ?? null,
        steps: stepsWithDag,
        triggers,
        parametersSchema: payload.parametersSchema ?? {},
        defaultParameters: payload.defaultParameters ?? {},
        metadata: payload.metadata ?? null,
        dag: dagMetadata
      });
      reply.status(201);
      await authResult.auth.log('succeeded', { workflowSlug: workflow.slug, workflowId: workflow.id });
      return { data: serializeWorkflowDefinition(workflow) };
    } catch (err) {
      if (err instanceof Error && /already exists/i.test(err.message)) {
        reply.status(409);
        await authResult.auth.log('failed', { reason: 'duplicate_workflow', message: err.message });
        return { error: err.message };
      }
      request.log.error({ err }, 'Failed to create workflow definition');
      reply.status(500);
      const message = err instanceof Error ? err.message : 'Failed to create workflow definition';
      await authResult.auth.log('failed', { reason: 'exception', message });
      return { error: 'Failed to create workflow definition' };
    }
  });

  app.post('/workflows/:slug/schedules', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflow-schedules.create',
      resource: 'workflows',
      requiredScopes: WORKFLOW_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_params',
        details: parseParams.error.flatten()
      });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = workflowScheduleCreateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten()
      });
      return { error: parseBody.error.flatten() };
    }

    const definition = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!definition) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'workflow_not_found',
        workflowSlug: parseParams.data.slug
      });
      return { error: 'workflow not found' };
    }

    const payload = parseBody.data;

    try {
      const schedule = await createWorkflowSchedule({
        workflowDefinitionId: definition.id,
        name: payload.name,
        description: payload.description,
        cron: payload.cron,
        timezone: payload.timezone ?? undefined,
        parameters: payload.parameters ?? null,
        startWindow: payload.startWindow ?? null,
        endWindow: payload.endWindow ?? null,
        catchUp: payload.catchUp,
        isActive: payload.isActive
      });

      reply.status(201);
      await authResult.auth.log('succeeded', {
        workflowSlug: definition.slug,
        workflowId: definition.id,
        scheduleId: schedule.id
      });
      return {
        data: {
          schedule: serializeWorkflowSchedule(schedule),
          workflow: {
            id: definition.id,
            slug: definition.slug,
            name: definition.name
          }
        }
      };
    } catch (err) {
      request.log.error({ err, slug: parseParams.data.slug }, 'Failed to create workflow schedule');
      reply.status(500);
      await authResult.auth.log('failed', {
        reason: 'exception',
        workflowSlug: definition.slug,
        message: (err as Error).message ?? 'unknown error'
      });
      return { error: 'Failed to create workflow schedule' };
    }
  });

  app.patch('/workflows/:slug', async (request, reply) => {
    const rawParams = request.params as Record<string, unknown> | undefined;
    const candidateSlug = typeof rawParams?.slug === 'string' ? rawParams.slug : 'unknown';

    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflows.update',
      resource: `workflow:${candidateSlug}`,
      requiredScopes: WORKFLOW_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_params', details: parseParams.error.flatten() });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = workflowDefinitionUpdateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten() });
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
    if (payload.description !== undefined) {
      updates.description = payload.description ?? null;
    }
    if (payload.parametersSchema !== undefined) {
      updates.parametersSchema = payload.parametersSchema ?? {};
    }
    if (payload.defaultParameters !== undefined) {
      updates.defaultParameters = payload.defaultParameters ?? {};
    }
    if (payload.metadata !== undefined) {
      updates.metadata = payload.metadata ?? null;
    }

    if (payload.steps !== undefined) {
      const normalizedSteps = await normalizeWorkflowSteps(payload.steps);
      try {
        const dagMetadata = buildWorkflowDagMetadata(normalizedSteps);
        const stepsWithDag = applyDagMetadataToSteps(normalizedSteps, dagMetadata) as WorkflowStepDefinition[];
        updates.steps = stepsWithDag;
        updates.dag = dagMetadata;
      } catch (err) {
        if (err instanceof WorkflowDagValidationError) {
          reply.status(400);
          await authResult.auth.log('failed', {
            reason: 'invalid_dag',
            message: err.message,
            detail: err.detail
          });
          return {
            error: {
              message: err.message,
              reason: err.reason,
              detail: err.detail
            }
          };
        }
        throw err;
      }
    }

    if (payload.triggers !== undefined) {
      updates.triggers = normalizeWorkflowTriggers(payload.triggers);
    }

    try {
      const updated = await updateWorkflowDefinition(parseParams.data.slug, updates);
      if (!updated) {
        reply.status(404);
        await authResult.auth.log('failed', {
          reason: 'workflow_not_found',
          workflowSlug: parseParams.data.slug
        });
        return { error: 'workflow not found' };
      }
      reply.status(200);
      await authResult.auth.log('succeeded', { workflowSlug: updated.slug, workflowId: updated.id });
      return { data: serializeWorkflowDefinition(updated) };
    } catch (err) {
      request.log.error({ err, slug: parseParams.data.slug }, 'Failed to update workflow definition');
      reply.status(500);
      const message = err instanceof Error ? err.message : 'Failed to update workflow definition';
      await authResult.auth.log('failed', {
        reason: 'exception',
        message,
        workflowSlug: parseParams.data.slug
      });
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

  app.get('/workflows/:slug/timeline', async (request, reply) => {
    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = workflowTimelineQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const now = new Date();
    const toDate = parseQuery.data.to ? new Date(parseQuery.data.to) : now;
    if (Number.isNaN(toDate.getTime())) {
      reply.status(400);
      return { error: 'Invalid `to` timestamp' };
    }

    let fromDate: Date;
    if (parseQuery.data.from) {
      fromDate = new Date(parseQuery.data.from);
      if (Number.isNaN(fromDate.getTime())) {
        reply.status(400);
        return { error: 'Invalid `from` timestamp' };
      }
    } else {
      const rangeKey = parseQuery.data.range ?? DEFAULT_TIMELINE_RANGE;
      const rangeMs = TIMELINE_RANGE_PRESETS[rangeKey] ?? TIMELINE_RANGE_PRESETS[DEFAULT_TIMELINE_RANGE];
      fromDate = new Date(toDate.getTime() - rangeMs);
    }

    if (fromDate > toDate) {
      reply.status(400);
      return { error: '`from` must be before `to`' };
    }

    const limit = parseQuery.data.limit ?? DEFAULT_TIMELINE_LIMIT;

    const rawStatuses = (parseQuery.data.status ?? [])
      .map((status) => status.trim().toLowerCase())
      .filter((status) => status.length > 0);
    const statuses = rawStatuses.filter((status) => TRIGGER_DELIVERY_STATUS_SET.has(status));
    const statusesFilter = statuses.length > 0 ? statuses : undefined;

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      return { error: 'workflow not found' };
    }

    const triggers = await listWorkflowEventTriggers({ workflowDefinitionId: workflow.id });
    const triggerMap = new Map(triggers.map((trigger) => [trigger.id, trigger]));

    const fromIso = fromDate.toISOString();
    const toIso = toDate.toISOString();

    const [runs, deliveries] = await Promise.all([
      listWorkflowRunsInRange(workflow.id, { from: fromIso, to: toIso, limit }),
      listWorkflowTriggerDeliveriesForWorkflow(workflow.id, {
        from: fromIso,
        to: toIso,
        limit,
        statuses: statusesFilter
      })
    ]);

    const eventIds = deliveries
      .map((delivery) => delivery.eventId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const events = eventIds.length > 0 ? await listWorkflowEventsByIds(eventIds) : [];
    const eventMap = new Map(events.map((event) => [event.id, event]));

    const triggerIds = Array.from(triggerMap.keys());
    const sources = Array.from(
      new Set(
        triggers
          .map((trigger) => trigger.eventSource)
          .filter((source): source is string => typeof source === 'string' && source.length > 0)
      )
    );

    const [triggerFailures, triggerPauses, sourcePauses] = await Promise.all([
      triggerIds.length > 0 ? listTriggerFailureEvents(triggerIds, fromIso, toIso, limit) : Promise.resolve([]),
      triggerIds.length > 0 ? listTriggerPauseEvents(triggerIds, fromIso, toIso, limit) : Promise.resolve([]),
      sources.length > 0 ? listSourcePauseEvents(sources, fromIso, toIso, limit) : Promise.resolve([])
    ]);

    const summarizeTrigger = (triggerId: string): TimelineTriggerSummary => {
      const trigger = triggerMap.get(triggerId);
      return {
        id: triggerId,
        name: trigger?.name ?? null,
        eventType: trigger?.eventType ?? 'unknown',
        eventSource: trigger?.eventSource ?? null,
        status: trigger?.status ?? 'active'
      } satisfies TimelineTriggerSummary;
    };

    const entries: WorkflowTimelineEntry[] = [];

    for (const run of runs) {
      const serializedRun = serializeWorkflowRun(run);
      const timestamp = coerceTimestamp(serializedRun.createdAt ?? run.createdAt, fromIso);
      entries.push({
        kind: 'run',
        id: run.id,
        timestamp,
        run: serializedRun
      });
    }

    for (const delivery of deliveries) {
      const serializedDelivery = serializeWorkflowTriggerDelivery(delivery);
      const timestamp = coerceTimestamp(serializedDelivery.createdAt ?? delivery.createdAt, fromIso);
      const event = delivery.eventId ? eventMap.get(delivery.eventId) ?? null : null;
      const serializedEvent = event ? serializeWorkflowEvent(event) : null;
      entries.push({
        kind: 'trigger',
        id: delivery.id,
        timestamp,
        delivery: serializedDelivery,
        trigger: summarizeTrigger(delivery.triggerId),
        event: serializedEvent
      });
    }

    for (const failure of triggerFailures) {
      const timestamp = coerceTimestamp(failure.failureTime, fromIso);
      entries.push({
        kind: 'scheduler',
        id: `trigger_failure:${failure.id}`,
        timestamp,
        category: 'trigger_failure',
        trigger: summarizeTrigger(failure.triggerId),
        reason: failure.reason ?? null
      });
    }

    for (const pause of triggerPauses) {
      const timestamp = coerceTimestamp(pause.updatedAt ?? pause.createdAt, fromIso);
      entries.push({
        kind: 'scheduler',
        id: `trigger_paused:${pause.triggerId}:${timestamp}`,
        timestamp,
        category: 'trigger_paused',
        trigger: summarizeTrigger(pause.triggerId),
        reason: pause.reason,
        failures: pause.failures,
        until: pause.pausedUntil
      });
    }

    for (const pause of sourcePauses) {
      const timestamp = coerceTimestamp(pause.updatedAt ?? pause.createdAt, fromIso);
      entries.push({
        kind: 'scheduler',
        id: `source_paused:${pause.source}:${timestamp}`,
        timestamp,
        category: 'source_paused',
        source: pause.source,
        reason: pause.reason,
        until: pause.pausedUntil,
        details: pause.details ?? null
      });
    }

    entries.sort((a, b) => {
      const timeA = Date.parse(a.timestamp);
      const timeB = Date.parse(b.timestamp);
      const normalizedA = Number.isNaN(timeA) ? 0 : timeA;
      const normalizedB = Number.isNaN(timeB) ? 0 : timeB;
      if (normalizedB !== normalizedA) {
        return normalizedB - normalizedA;
      }
      return a.id.localeCompare(b.id);
    });

    const limitedEntries = entries.slice(0, limit);

    reply.status(200);
    return {
      data: {
        workflow: {
          id: workflow.id,
          slug: workflow.slug,
          name: workflow.name
        },
        range: {
          from: fromIso,
          to: toIso
        },
        entries: limitedEntries
      },
      meta: {
        counts: {
          runs: runs.length,
          triggerDeliveries: deliveries.length,
          schedulerSignals: triggerFailures.length + triggerPauses.length + sourcePauses.length
        },
        appliedTriggerStatuses: statusesFilter ?? [],
        limit
      }
    };
  });

  app.get('/workflows/:slug/auto-materialize', async (request, reply) => {
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

    const [runs, claim, failureState] = await Promise.all([
      listWorkflowAutoRunsForDefinition(workflow.id, { limit, offset }),
      getWorkflowAutoRunClaim(workflow.id),
      getAutoMaterializeFailureState(workflow.id)
    ]);

    reply.status(200);
    return {
      data: {
        runs: runs.map((run) => serializeWorkflowRun(run)),
        inFlight: claim
          ? {
              workflowRunId: claim.workflowRunId,
              reason: claim.reason,
              assetId: claim.assetId,
              partitionKey: claim.partitionKey,
              requestedAt: claim.requestedAt,
              claimedAt: claim.claimedAt,
              claimOwner: claim.claimOwner,
              context: claim.context ?? null
            }
          : null,
        cooldown: failureState
          ? {
              failures: failureState.failures,
              nextEligibleAt: failureState.nextEligibleAt
            }
          : null,
        updatedAt: new Date().toISOString()
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

  app.patch('/workflow-schedules/:scheduleId', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflow-schedules.update',
      resource: 'workflows',
      requiredScopes: WORKFLOW_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = workflowScheduleIdParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_params',
        details: parseParams.error.flatten()
      });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = workflowScheduleUpdateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten()
      });
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;

    const schedule = await updateWorkflowSchedule(parseParams.data.scheduleId, {
      name: payload.name === undefined ? undefined : payload.name,
      description: payload.description === undefined ? undefined : payload.description,
      cron: payload.cron,
      timezone: payload.timezone ?? undefined,
      parameters: payload.parameters ?? undefined,
      startWindow: payload.startWindow ?? undefined,
      endWindow: payload.endWindow ?? undefined,
      catchUp: payload.catchUp,
      isActive: payload.isActive
    });

    if (!schedule) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'schedule_not_found',
        scheduleId: parseParams.data.scheduleId
      });
      return { error: 'schedule not found' };
    }

    const summary = await getWorkflowScheduleWithWorkflow(schedule.id);
    if (!summary) {
      reply.status(200);
      await authResult.auth.log('succeeded', {
        scheduleId: schedule.id
      });
      return { data: { schedule: serializeWorkflowSchedule(schedule) } };
    }

    reply.status(200);
    await authResult.auth.log('succeeded', {
      workflowSlug: summary.workflow.slug,
      workflowId: summary.workflow.id,
      scheduleId: summary.schedule.id
    });
    return {
      data: {
        schedule: serializeWorkflowSchedule(summary.schedule),
        workflow: {
          id: summary.workflow.id,
          slug: summary.workflow.slug,
          name: summary.workflow.name
        }
      }
    };
  });

  app.delete('/workflow-schedules/:scheduleId', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflow-schedules.delete',
      resource: 'workflows',
      requiredScopes: WORKFLOW_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = workflowScheduleIdParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_params',
        details: parseParams.error.flatten()
      });
      return { error: parseParams.error.flatten() };
    }

    const removed = await deleteWorkflowSchedule(parseParams.data.scheduleId);
    if (!removed) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'schedule_not_found',
        scheduleId: parseParams.data.scheduleId
      });
      return { error: 'schedule not found' };
    }

    reply.status(204);
    await authResult.auth.log('succeeded', {
      scheduleId: parseParams.data.scheduleId
    });
    return reply.send();
  });

  app.get('/workflows/:slug/stats', async (request, reply) => {
    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = workflowAnalyticsQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const normalized = normalizeAnalyticsQuery(parseQuery.data ?? {});
    if (!normalized.ok) {
      reply.status(400);
      return { error: ANALYTICS_ERROR_MESSAGES[normalized.error] ?? 'Invalid analytics query' };
    }

    try {
      const stats = await getWorkflowRunStatsBySlug(
        parseParams.data.slug,
        normalized.value.options
      );
      const serialized = serializeWorkflowRunStats(stats);
      reply.status(200);
      return {
        data: {
          ...serialized,
          range: { ...serialized.range, key: normalized.value.rangeKey }
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) {
        reply.status(404);
        return { error: 'workflow not found' };
      }
      request.log.error({ err, workflow: parseParams.data.slug }, 'Failed to load workflow stats');
      reply.status(500);
      return { error: 'Failed to load workflow stats' };
    }
  });

  app.get('/workflows/:slug/run-metrics', async (request, reply) => {
    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = workflowAnalyticsQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const normalized = normalizeAnalyticsQuery(parseQuery.data ?? {});
    if (!normalized.ok) {
      reply.status(400);
      return { error: ANALYTICS_ERROR_MESSAGES[normalized.error] ?? 'Invalid analytics query' };
    }

    try {
      const metrics = await getWorkflowRunMetricsBySlug(
        parseParams.data.slug,
        normalized.value.options
      );
      const serialized = serializeWorkflowRunMetrics(metrics);
      const bucketKey =
        normalized.value.bucketKey ?? mapIntervalToBucketKey(serialized.bucketInterval);

      reply.status(200);
      return {
        data: {
          ...serialized,
          range: { ...serialized.range, key: normalized.value.rangeKey },
          bucket: {
            interval: serialized.bucketInterval,
            key: bucketKey
          }
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) {
        reply.status(404);
        return { error: 'workflow not found' };
      }
      request.log.error(
        { err, workflow: parseParams.data.slug },
        'Failed to load workflow metrics'
      );
      reply.status(500);
      return { error: 'Failed to load workflow metrics' };
    }
  });

  app.get('/workflows/:slug/assets', async (request, reply) => {
    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      return { error: 'workflow not found' };
    }

    const stepMetadata = buildWorkflowStepMetadata(workflow.steps);
    const assetDeclarations = await listWorkflowAssetDeclarationsBySlug(workflow.slug);

    type StepDescriptor = {
      stepId: string;
      stepName: string;
      stepType: WorkflowStepDefinition['type'];
      schema: JsonValue | null;
      freshness: WorkflowAssetDeclaration['freshness'] | null;
      autoMaterialize: WorkflowAssetDeclaration['autoMaterialize'] | null;
      partitioning: WorkflowAssetDeclaration['partitioning'] | null;
    };

    const assets = new Map<
      string,
      {
        assetId: string;
        producers: StepDescriptor[];
        consumers: StepDescriptor[];
      }
    >();

    const ensureEntry = (assetId: string) => {
      let entry = assets.get(assetId);
      if (!entry) {
        entry = { assetId, producers: [], consumers: [] };
        assets.set(assetId, entry);
      }
      return entry;
    };

    const describeStep = (
      stepId: string,
      schema: JsonValue | null,
      freshness: WorkflowAssetDeclaration['freshness'],
      autoMaterialize: WorkflowAssetDeclaration['autoMaterialize'],
      partitioning: WorkflowAssetDeclaration['partitioning']
    ) => {
      const metadata = stepMetadata.get(stepId);
      return {
        stepId,
        stepName: metadata?.name ?? stepId,
        stepType: metadata?.type ?? 'job',
        schema: schema ?? null,
        freshness: freshness ?? null,
        autoMaterialize: autoMaterialize ?? null,
        partitioning: partitioning ?? null
      } satisfies StepDescriptor;
    };

    for (const declaration of assetDeclarations) {
      if (declaration.workflowDefinitionId !== workflow.id) {
        continue;
      }
      const entry = ensureEntry(declaration.assetId);
      const descriptor = describeStep(
        declaration.stepId,
        declaration.schema ?? null,
        declaration.freshness ?? null,
        declaration.autoMaterialize ?? null,
        declaration.partitioning ?? null
      );
      if (declaration.direction === 'produces') {
        entry.producers.push(descriptor);
      } else {
        entry.consumers.push(descriptor);
      }
    }

    const latestSnapshots = await listLatestWorkflowAssetSnapshots(workflow.id);
    const latestByAsset = new Map<string, WorkflowAssetSnapshotRecord>();
    for (const snapshot of latestSnapshots) {
      const assetId = snapshot.asset.assetId;
      ensureEntry(assetId);
      const existing = latestByAsset.get(assetId);
      if (!existing || isNewerAssetSnapshot(existing, snapshot)) {
        latestByAsset.set(assetId, snapshot);
      }
    }

    const payload = Array.from(assets.values())
      .map((entry) => {
        const snapshot = latestByAsset.get(entry.assetId);
        const latest = snapshot
          ? {
              runId: snapshot.workflowRunId,
              runStatus: snapshot.runStatus,
              stepId: snapshot.workflowStepId,
              stepName: stepMetadata.get(snapshot.workflowStepId)?.name ?? snapshot.workflowStepId,
              stepType: stepMetadata.get(snapshot.workflowStepId)?.type ?? 'job',
              stepStatus: snapshot.stepStatus,
              producedAt: snapshot.asset.producedAt,
              partitionKey: snapshot.asset.partitionKey,
              payload: snapshot.asset.payload,
              schema: snapshot.asset.schema,
              freshness: snapshot.asset.freshness,
              runStartedAt: snapshot.runStartedAt,
              runCompletedAt: snapshot.runCompletedAt
            }
          : null;

        return {
          assetId: entry.assetId,
          producers: entry.producers,
          consumers: entry.consumers,
          latest,
          available: Boolean(latest)
        };
      })
      .sort((a, b) => a.assetId.localeCompare(b.assetId));

    reply.status(200);
    return { data: { assets: payload } };
  });

  app.get('/workflows/:slug/assets/:assetId/history', async (request, reply) => {
    const parseParams = workflowAssetParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = workflowAssetHistoryQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      return { error: 'workflow not found' };
    }

    const assetDeclarations = await listWorkflowAssetDeclarationsBySlug(workflow.slug);
    const assetExists = assetDeclarations.some(
      (declaration) =>
        declaration.workflowDefinitionId === workflow.id &&
        declaration.assetId.toLowerCase() === parseParams.data.assetId.toLowerCase()
    );

    if (!assetExists) {
      reply.status(404);
      return { error: 'asset not found for workflow' };
    }

    const limit = parseQuery.data.limit ?? 10;
    const rawPartitionKey = typeof parseQuery.data.partitionKey === 'string' ? parseQuery.data.partitionKey.trim() : '';

    const partitioningSpec = assetDeclarations.find(
      (declaration) =>
        declaration.workflowDefinitionId === workflow.id &&
        declaration.assetId.toLowerCase() === parseParams.data.assetId.toLowerCase() &&
        declaration.partitioning
    )?.partitioning;

    let partitionKeyFilter: string | null | undefined;
    if (rawPartitionKey) {
      const validation = validatePartitionKey(partitioningSpec ?? null, rawPartitionKey);
      if (!validation.ok) {
        reply.status(400);
        return { error: validation.error };
      }
      partitionKeyFilter = validation.key;
    }

    const history = await listWorkflowAssetHistory(workflow.id, parseParams.data.assetId, {
      limit,
      partitionKey: partitionKeyFilter ?? null
    });
    const stepMetadata = buildWorkflowStepMetadata(workflow.steps);

    const describeRole = (declaration: WorkflowAssetDeclarationRecord) => ({
      stepId: declaration.stepId,
      stepName: stepMetadata.get(declaration.stepId)?.name ?? declaration.stepId,
      stepType: stepMetadata.get(declaration.stepId)?.type ?? 'job',
      schema: declaration.schema ?? null,
      freshness: declaration.freshness ?? null,
      partitioning: declaration.partitioning ?? null
    });

    const producers = assetDeclarations
      .filter(
        (declaration) =>
          declaration.workflowDefinitionId === workflow.id &&
          declaration.direction === 'produces' &&
          declaration.assetId.toLowerCase() === parseParams.data.assetId.toLowerCase()
      )
      .map(describeRole);

    const consumers = assetDeclarations
      .filter(
        (declaration) =>
          declaration.workflowDefinitionId === workflow.id &&
          declaration.direction === 'consumes' &&
          declaration.assetId.toLowerCase() === parseParams.data.assetId.toLowerCase()
      )
      .map(describeRole);

    const serialized = history.map((entry) => ({
      runId: entry.workflowRunId,
      runStatus: entry.runStatus,
      stepId: entry.workflowStepId,
      stepName: stepMetadata.get(entry.workflowStepId)?.name ?? entry.workflowStepId,
      stepType: stepMetadata.get(entry.workflowStepId)?.type ?? 'job',
      stepStatus: entry.stepStatus,
      producedAt: entry.asset.producedAt,
      partitionKey: entry.asset.partitionKey,
      payload: entry.asset.payload,
      schema: entry.asset.schema,
      freshness: entry.asset.freshness,
      runStartedAt: entry.runStartedAt,
      runCompletedAt: entry.runCompletedAt
    }));

    reply.status(200);
    return {
      data: {
        assetId: parseParams.data.assetId,
        producers,
        consumers,
        history: serialized,
        limit,
        partitionKey: partitionKeyFilter ?? null
      }
    };
  });

  app.get('/workflows/:slug/assets/:assetId/partitions', async (request, reply) => {
    const parseParams = workflowAssetParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = workflowAssetPartitionsQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      return { error: 'workflow not found' };
    }

    const assetDeclarations = await listWorkflowAssetDeclarationsBySlug(workflow.slug);
    const assetMatches = assetDeclarations.filter(
      (declaration) =>
        declaration.workflowDefinitionId === workflow.id &&
        declaration.assetId.toLowerCase() === parseParams.data.assetId.toLowerCase()
    );

    if (assetMatches.length === 0) {
      reply.status(404);
      return { error: 'asset not found for workflow' };
    }

    const partitioningSpec = assetMatches.find((declaration) => declaration.partitioning)?.partitioning ?? null;
    const partitions = await listWorkflowAssetPartitions(workflow.id, parseParams.data.assetId);
    const partitionMap = new Map<string, typeof partitions[number]>();

    for (const entry of partitions) {
      const key = entry.partitionKey ?? '';
      partitionMap.set(key, entry);
    }

    if (partitioningSpec && (partitioningSpec.type === 'static' || partitioningSpec.type === 'timeWindow')) {
      const enumerated = enumeratePartitionKeys(partitioningSpec, {
        lookback: parseQuery.data.lookback,
        now: new Date()
      });
      for (const key of enumerated) {
        const mapKey = key ?? '';
        if (!partitionMap.has(mapKey)) {
          partitionMap.set(mapKey, {
            assetId: parseParams.data.assetId,
            partitionKey: key,
            latest: null,
            materializationCount: 0,
            isStale: false,
            staleMetadata: null,
            parameters: null,
            parametersSource: null,
            parametersCapturedAt: null,
            parametersUpdatedAt: null
          });
        }
      }
    } else if (!partitioningSpec && partitionMap.size === 0) {
      partitionMap.set('', {
        assetId: parseParams.data.assetId,
        partitionKey: null,
        latest: null,
        materializationCount: 0,
        isStale: false,
        staleMetadata: null,
        parameters: null,
        parametersSource: null,
        parametersCapturedAt: null,
        parametersUpdatedAt: null
      });
    }

    const stepMetadata = buildWorkflowStepMetadata(workflow.steps);

    const partitionSummaries = Array.from(partitionMap.values()).map((entry) => {
      const latest = entry.latest
        ? {
            runId: entry.latest.workflowRunId,
            runStatus: entry.latest.runStatus,
            stepId: entry.latest.workflowStepId,
            stepName:
              stepMetadata.get(entry.latest.workflowStepId)?.name ?? entry.latest.workflowStepId,
            stepType:
              stepMetadata.get(entry.latest.workflowStepId)?.type ?? 'job',
            stepStatus: entry.latest.stepStatus,
            producedAt: entry.latest.asset.producedAt,
            payload: entry.latest.asset.payload,
            schema: entry.latest.asset.schema,
            freshness: entry.latest.asset.freshness,
            partitionKey: entry.latest.asset.partitionKey,
            runStartedAt: entry.latest.runStartedAt,
            runCompletedAt: entry.latest.runCompletedAt
          }
        : null;

      return {
        partitionKey: entry.partitionKey,
        materializations: entry.materializationCount,
        latest,
        isStale: entry.isStale,
        staleMetadata: entry.staleMetadata,
        parameters: entry.parameters,
        parametersSource: entry.parametersSource,
        parametersCapturedAt: entry.parametersCapturedAt,
        parametersUpdatedAt: entry.parametersUpdatedAt,
        assetId: entry.assetId
      };
    });

    partitionSummaries.sort((a, b) => {
      const aTime = toEpochMillis(a.latest?.producedAt ?? null);
      const bTime = toEpochMillis(b.latest?.producedAt ?? null);
      if (aTime !== null && bTime !== null && aTime !== bTime) {
        return bTime - aTime;
      }
      const aKey = a.partitionKey ?? '';
      const bKey = b.partitionKey ?? '';
      return aKey.localeCompare(bKey);
    });

    reply.status(200);
    return {
      data: {
        assetId: parseParams.data.assetId,
        partitioning: partitioningSpec ?? null,
        partitions: partitionSummaries
      }
    };
  });

  app.put('/workflows/:slug/assets/:assetId/partition-parameters', async (request, reply) => {
    const rawParams = request.params as Record<string, unknown> | undefined;
    const candidateSlug = typeof rawParams?.slug === 'string' ? rawParams.slug : 'unknown';

    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflows.run',
      resource: `workflow:${candidateSlug}`,
      requiredScopes: WORKFLOW_RUN_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = workflowAssetParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_params',
        details: parseParams.error.flatten()
      });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = workflowAssetPartitionParametersSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten(),
        workflowSlug: parseParams.data.slug,
        assetId: parseParams.data.assetId
      });
      return { error: parseBody.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'workflow_not_found',
        workflowSlug: parseParams.data.slug
      });
      return { error: 'workflow not found' };
    }

    const assetDeclarations = await listWorkflowAssetDeclarationsBySlug(workflow.slug);
    const assetMatches = assetDeclarations.filter(
      (declaration) =>
        declaration.workflowDefinitionId === workflow.id &&
        declaration.assetId.toLowerCase() === parseParams.data.assetId.toLowerCase()
    );

    if (assetMatches.length === 0) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'asset_not_found',
        workflowSlug: workflow.slug,
        assetId: parseParams.data.assetId
      });
      return { error: 'asset not found for workflow' };
    }

    const partitioningSpec = assetMatches.find((declaration) => declaration.partitioning)?.partitioning ?? null;
    const rawPartitionKey = parseBody.data.partitionKey ?? null;
    const candidateKey = typeof rawPartitionKey === 'string' ? rawPartitionKey.trim() : '';
    const validation = validatePartitionKey(partitioningSpec, candidateKey);
    if (!validation.ok) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_partition_key',
        workflowSlug: workflow.slug,
        assetId: parseParams.data.assetId,
        partitionKey: candidateKey,
        error: validation.error
      });
      return { error: validation.error };
    }

    const normalizedPartitionKey = validation.key.trim();
    const effectivePartitionKey = normalizedPartitionKey.length > 0 ? normalizedPartitionKey : null;

    await setWorkflowAssetPartitionParameters(
      workflow.id,
      parseParams.data.assetId,
      effectivePartitionKey,
      parseBody.data.parameters,
      'manual'
    );

    const record = await getWorkflowAssetPartitionParameters(
      workflow.id,
      parseParams.data.assetId,
      effectivePartitionKey
    );

    await authResult.auth.log('succeeded', {
      reason: 'partition_parameters_updated',
      workflowSlug: workflow.slug,
      assetId: parseParams.data.assetId,
      partitionKey: effectivePartitionKey
    });

    reply.status(200);
    return {
      data: {
        assetId: parseParams.data.assetId,
        partitionKey: record?.partitionKey ?? effectivePartitionKey,
        parameters: record?.parameters ?? parseBody.data.parameters,
        source: record?.source ?? 'manual',
        capturedAt: record?.capturedAt ?? new Date().toISOString(),
        updatedAt: record?.updatedAt ?? new Date().toISOString()
      }
    };
  });

  app.delete('/workflows/:slug/assets/:assetId/partition-parameters', async (request, reply) => {
    const rawParams = request.params as Record<string, unknown> | undefined;
    const candidateSlug = typeof rawParams?.slug === 'string' ? rawParams.slug : 'unknown';

    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflows.run',
      resource: `workflow:${candidateSlug}`,
      requiredScopes: WORKFLOW_RUN_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = workflowAssetParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_params',
        details: parseParams.error.flatten()
      });
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = workflowAssetPartitionParamsQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_query',
        details: parseQuery.error.flatten(),
        workflowSlug: parseParams.data.slug,
        assetId: parseParams.data.assetId
      });
      return { error: parseQuery.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'workflow_not_found',
        workflowSlug: parseParams.data.slug
      });
      return { error: 'workflow not found' };
    }

    const assetDeclarations = await listWorkflowAssetDeclarationsBySlug(workflow.slug);
    const assetMatches = assetDeclarations.filter(
      (declaration) =>
        declaration.workflowDefinitionId === workflow.id &&
        declaration.assetId.toLowerCase() === parseParams.data.assetId.toLowerCase()
    );

    if (assetMatches.length === 0) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'asset_not_found',
        workflowSlug: workflow.slug,
        assetId: parseParams.data.assetId
      });
      return { error: 'asset not found for workflow' };
    }

    const partitioningSpec = assetMatches.find((declaration) => declaration.partitioning)?.partitioning ?? null;
    const rawPartitionKey = parseQuery.data.partitionKey ?? null;
    const candidateKey = typeof rawPartitionKey === 'string' ? rawPartitionKey.trim() : '';
    const validation = validatePartitionKey(partitioningSpec, candidateKey);
    if (!validation.ok) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_partition_key',
        workflowSlug: workflow.slug,
        assetId: parseParams.data.assetId,
        partitionKey: candidateKey,
        error: validation.error
      });
      return { error: validation.error };
    }

    const normalizedPartitionKey = validation.key.trim();
    const effectivePartitionKey = normalizedPartitionKey.length > 0 ? normalizedPartitionKey : null;

    await removeWorkflowAssetPartitionParameters(
      workflow.id,
      parseParams.data.assetId,
      effectivePartitionKey
    );

    await authResult.auth.log('succeeded', {
      reason: 'partition_parameters_removed',
      workflowSlug: workflow.slug,
      assetId: parseParams.data.assetId,
      partitionKey: effectivePartitionKey
    });

    reply.status(204).send();
    return;
  });

  app.post('/workflows/:slug/run', async (request, reply) => {
    const rawParams = request.params as Record<string, unknown> | undefined;
    const candidateSlug = typeof rawParams?.slug === 'string' ? rawParams.slug : 'unknown';

    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflows.run',
      resource: `workflow:${candidateSlug}`,
      requiredScopes: WORKFLOW_RUN_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_params', details: parseParams.error.flatten() });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = workflowRunRequestSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten(),
        workflowSlug: parseParams.data.slug
      });
      return { error: parseBody.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      await authResult.auth.log('failed', { reason: 'workflow_not_found', workflowSlug: parseParams.data.slug });
      return { error: 'workflow not found' };
    }

    const parameters = parseBody.data.parameters ?? workflow.defaultParameters ?? {};
    const triggeredBy = parseBody.data.triggeredBy ?? null;
    const trigger = parseBody.data.trigger ?? undefined;
    const partitionedAssets = collectPartitionedAssetsFromSteps(workflow.steps);

    const rawPartitionKey = parseBody.data.partitionKey ?? null;
    let partitionKey: string | null = null;

    if (partitionedAssets.size > 0) {
      const suppliedKey = typeof rawPartitionKey === 'string' ? rawPartitionKey.trim() : '';
      if (!suppliedKey) {
        reply.status(400);
        await authResult.auth.log('failed', {
          reason: 'partition_key_required',
          workflowSlug: workflow.slug
        });
        return { error: 'partitionKey is required for partitioned workflows' };
      }

      for (const [assetKey, partitioning] of partitionedAssets.entries()) {
        const validation = validatePartitionKey(partitioning ?? null, suppliedKey);
        if (!validation.ok) {
          reply.status(400);
          await authResult.auth.log('failed', {
            reason: 'invalid_partition_key',
            workflowSlug: workflow.slug,
            assetId: assetKey,
            message: validation.error
          });
          return {
            error: `Invalid partition key for asset ${assetKey}: ${validation.error}`
          };
        }
        partitionKey = validation.key;
      }
    } else if (typeof rawPartitionKey === 'string' && rawPartitionKey.trim().length > 0) {
      partitionKey = rawPartitionKey.trim();
    }

    const run = await createWorkflowRun(workflow.id, {
      parameters,
      triggeredBy,
      trigger,
      partitionKey
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
      await authResult.auth.log('failed', {
        reason: 'enqueue_failed',
        workflowSlug: workflow.slug,
        runId: run.id,
        message
      });
      return { error: message };
    }

    const latestRun = (await getWorkflowRunById(run.id)) ?? run;
    reply.status(202);
    await authResult.auth.log('succeeded', {
      workflowSlug: workflow.slug,
      runId: latestRun.id,
      status: latestRun.status,
      partitionKey: latestRun.partitionKey ?? partitionKey ?? null
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
}
