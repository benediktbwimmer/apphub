import { logger } from './observability/logger';
import { normalizeMeta } from './observability/meta';
import {
  listEventSamplingReplayCandidates,
  recordEventSamplingReplayResult,
  countPendingEventSamplingReplays,
  type EventSamplingReplayCandidate,
  type EventSamplingReplayStatus
} from './db/workflowEventSamplingReplay';
import {
  getWorkflowRunStepByJobRunId,
  getWorkflowRunStepById,
  getWorkflowRunById,
  getWorkflowDefinitionById
} from './db/workflows';
import { upsertWorkflowEventProducerSample } from './db/workflowEventSamples';
import type {
  WorkflowDefinitionRecord,
  WorkflowRunStepRecord,
  WorkflowRunRecord,
  WorkflowEventRecord
} from './db/types';

const DEFAULT_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_REPLAY_LIMIT = 100;
const DEFAULT_MAX_ATTEMPTS = 5;

export type EventSamplingReplayOptions = {
  lookbackMs?: number;
  limit?: number;
  includeProcessed?: boolean;
  dryRun?: boolean;
  maxAttempts?: number;
};

export type EventSamplingReplaySummary = {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  pending: number;
  errors: Array<{ eventId: string; reason: string }>;
  dryRun: boolean;
};

type DerivedSamplingContext = {
  workflowDefinitionId: string;
  workflowRunId: string;
  workflowRunStepId: string;
  jobRunId: string;
  jobSlug: string;
};

type DerivationResult =
  | { ok: true; context: DerivedSamplingContext }
  | { ok: false; status: EventSamplingReplayStatus; reason: string };

const definitionCache = new Map<string, WorkflowDefinitionRecord>();
const runCache = new Map<string, WorkflowRunRecord>();

function resolveLookbackMs(candidate: number | undefined): number {
  if (!Number.isFinite(candidate ?? NaN)) {
    return DEFAULT_LOOKBACK_MS;
  }
  const normalized = Math.max(Math.floor(candidate as number), 0);
  return normalized > 0 ? normalized : DEFAULT_LOOKBACK_MS;
}

function resolveLimit(candidate: number | undefined): number {
  if (!Number.isFinite(candidate ?? NaN)) {
    return DEFAULT_REPLAY_LIMIT;
  }
  const normalized = Math.floor(candidate as number);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return DEFAULT_REPLAY_LIMIT;
  }
  return Math.min(normalized, 500);
}

function resolveMaxAttempts(candidate: number | undefined): number {
  if (!Number.isFinite(candidate ?? NaN)) {
    return DEFAULT_MAX_ATTEMPTS;
  }
  const normalized = Math.floor(candidate as number);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return DEFAULT_MAX_ATTEMPTS;
  }
  return normalized;
}

async function loadWorkflowDefinition(definitionId: string): Promise<WorkflowDefinitionRecord | null> {
  const cached = definitionCache.get(definitionId);
  if (cached) {
    return cached;
  }
  const definition = await getWorkflowDefinitionById(definitionId);
  if (definition) {
    definitionCache.set(definitionId, definition);
  }
  return definition;
}

async function loadWorkflowRun(runId: string): Promise<WorkflowRunRecord | null> {
  const cached = runCache.get(runId);
  if (cached) {
    return cached;
  }
  const run = await getWorkflowRunById(runId);
  if (run) {
    runCache.set(runId, run);
  }
  return run;
}

function resolveJobSlugFromDefinition(
  definition: WorkflowDefinitionRecord,
  stepId: string,
  templateStepId: string | null
): string | null {
  const direct = definition.steps.find((entry) => entry.id === stepId);
  if (direct) {
    if (direct.type === 'job') {
      return direct.jobSlug;
    }
    if (direct.type === 'fanout' && direct.template.type === 'job') {
      return direct.template.jobSlug;
    }
  }

  if (templateStepId) {
    const template = definition.steps.find((entry) => entry.id === templateStepId);
    if (template) {
      if (template.type === 'job') {
        return template.jobSlug;
      }
      if (template.type === 'fanout' && template.template.type === 'job') {
        return template.template.jobSlug;
      }
    }
  }

  for (const entry of definition.steps) {
    if (entry.type === 'fanout' && entry.template.id === stepId && entry.template.type === 'job') {
      return entry.template.jobSlug;
    }
  }

  return null;
}

async function deriveSamplingContext(event: WorkflowEventRecord): Promise<DerivationResult> {
  const correlationId = typeof event.correlationId === 'string' ? event.correlationId.trim() : '';
  if (!correlationId) {
    return { ok: false, status: 'skipped', reason: 'missing_correlation_id' };
  }

  let step: WorkflowRunStepRecord | null = await getWorkflowRunStepByJobRunId(correlationId);

  if (!step) {
    step = await getWorkflowRunStepById(correlationId);
  }

  if (!step) {
    return { ok: false, status: 'failed', reason: 'workflow_step_not_found' };
  }

  const run = await loadWorkflowRun(step.workflowRunId);
  if (!run) {
    return { ok: false, status: 'failed', reason: 'workflow_run_not_found' };
  }

  const definition = await loadWorkflowDefinition(run.workflowDefinitionId);
  if (!definition) {
    return { ok: false, status: 'failed', reason: 'workflow_definition_not_found' };
  }

  const jobSlug = resolveJobSlugFromDefinition(definition, step.stepId, step.templateStepId);
  if (!jobSlug) {
    return { ok: false, status: 'failed', reason: 'job_slug_unresolved' };
  }

  const jobRunId = typeof step.jobRunId === 'string' && step.jobRunId.trim().length > 0
    ? step.jobRunId.trim()
    : correlationId;

  return {
    ok: true,
    context: {
      workflowDefinitionId: definition.id,
      workflowRunId: run.id,
      workflowRunStepId: step.id,
      jobRunId,
      jobSlug
    }
  } satisfies DerivationResult;
}

export async function replayWorkflowEventSampling(
  options: EventSamplingReplayOptions = {}
): Promise<EventSamplingReplaySummary> {
  const lookbackMs = resolveLookbackMs(options.lookbackMs);
  const limit = resolveLimit(options.limit);
  const now = Date.now();
  const fromIso = new Date(now - lookbackMs).toISOString();
  const toIso = new Date(now).toISOString();
  const includeProcessed = options.includeProcessed ?? false;
  const dryRun = options.dryRun ?? false;
  const maxAttempts = resolveMaxAttempts(options.maxAttempts);

  definitionCache.clear();
  runCache.clear();

  const candidates = await listEventSamplingReplayCandidates({
    from: fromIso,
    to: toIso,
    limit,
    includeProcessed
  });

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const errors: Array<{ eventId: string; reason: string }> = [];

  for (const candidate of candidates) {
    const { event, state } = candidate;

    if (state && state.status === 'succeeded') {
      skipped += 1;
      errors.push({ eventId: event.id, reason: 'already_processed' });
      continue;
    }

    if (state && state.status === 'failed' && state.attempts >= maxAttempts) {
      skipped += 1;
      errors.push({ eventId: event.id, reason: 'max_attempts_reached' });
      continue;
    }

    const derivation = await deriveSamplingContext(event);
    processed += 1;

    if (!derivation.ok) {
      const { status, reason } = derivation;
      errors.push({ eventId: event.id, reason });
      if (!dryRun) {
        await recordEventSamplingReplayResult({
          eventId: event.id,
          status,
          workflowDefinitionId: null,
          workflowRunId: null,
          workflowRunStepId: null,
          jobRunId: null,
          jobSlug: null,
          error: reason
        });
      }

      if (status === 'failed') {
        failed += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    const context = derivation.context;

    if (!dryRun) {
      try {
        await upsertWorkflowEventProducerSample({
          workflowDefinitionId: context.workflowDefinitionId,
          workflowRunStepId: context.workflowRunStepId,
          jobSlug: context.jobSlug,
          eventType: event.type,
          eventSource: event.source,
          observedAt: event.occurredAt
        });

        await recordEventSamplingReplayResult({
          eventId: event.id,
          status: 'succeeded',
          workflowDefinitionId: context.workflowDefinitionId,
          workflowRunId: context.workflowRunId,
          workflowRunStepId: context.workflowRunStepId,
          jobRunId: context.jobRunId,
          jobSlug: context.jobSlug,
          error: null
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failed += 1;
        errors.push({ eventId: event.id, reason: message });
        await recordEventSamplingReplayResult({
          eventId: event.id,
          status: 'failed',
          workflowDefinitionId: context.workflowDefinitionId,
          workflowRunId: context.workflowRunId,
          workflowRunStepId: context.workflowRunStepId,
          jobRunId: context.jobRunId,
          jobSlug: context.jobSlug,
          error: message
        });
        logger.error(
          'Event sampling replay failed to upsert sample',
          normalizeMeta({
            eventId: event.id,
            workflowDefinitionId: context.workflowDefinitionId,
            workflowRunStepId: context.workflowRunStepId,
            jobSlug: context.jobSlug,
            error: message
          })
        );
        continue;
      }
    }

    succeeded += 1;
  }

  const pending = await countPendingEventSamplingReplays({
    from: fromIso,
    to: toIso,
    includeProcessed
  });

  const summary: EventSamplingReplaySummary = {
    processed,
    succeeded,
    failed,
    skipped,
    pending,
    errors,
    dryRun
  };

  logger.info(
    'Event sampling replay summary',
    normalizeMeta({
      processed,
      succeeded,
      failed,
      skipped,
      pending,
      dryRun,
      errorCount: errors.length
    })
  );

  return summary;
}
