import type { EventEnvelope } from '@apphub/event-bus';
import { insertWorkflowEvent, getWorkflowEventById } from './db/workflowEvents';
import { upsertWorkflowEventProducerSample } from './db/workflowEventSamples';
import type { WorkflowEventRecord, WorkflowEventProducerSampleRecord } from './db/types';
import { emitApphubEvent, type ApphubEvent } from './events';
import { logger } from './observability/logger';
import { normalizeMeta } from './observability/meta';
import { deriveWorkflowEventSubtype } from './workflowEventInsights';

const WORKFLOW_METADATA_KEY = '__apphubWorkflow';
const MAX_IDENTIFIER_LENGTH = 256;
const SAMPLE_OVERFLOW_WARNING_THRESHOLD = resolveOverflowThreshold(
  process.env.EVENT_SAMPLING_OVERFLOW_THRESHOLD,
  50_000
);

type WorkflowMetadataContext = {
  workflowDefinitionId: string;
  workflowRunId: string;
  workflowRunStepId: string;
  jobRunId: string;
  jobSlug: string;
};

type WorkflowMetadataParseResult =
  | { status: 'missing' }
  | { status: 'invalid'; reason: string; metadata: unknown }
  | { status: 'valid'; context: WorkflowMetadataContext };

function resolveOverflowThreshold(candidate: string | undefined, fallback: number): number {
  if (!candidate) {
    return fallback;
  }
  const parsed = Number(candidate);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (trimmed.length > MAX_IDENTIFIER_LENGTH) {
    return null;
  }
  return trimmed;
}

function parseWorkflowMetadata(envelope: EventEnvelope): WorkflowMetadataParseResult {
  const metadata = envelope.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { status: 'missing' };
  }
  const candidate = (metadata as Record<string, unknown>)[WORKFLOW_METADATA_KEY];
  if (candidate === undefined) {
    return { status: 'missing' };
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { status: 'invalid', reason: 'metadata_not_object', metadata: candidate };
  }

  const context = candidate as Record<string, unknown>;
  const workflowDefinitionId = normalizeIdentifier(context.workflowDefinitionId);
  const workflowRunId = normalizeIdentifier(context.workflowRunId);
  const workflowRunStepId = normalizeIdentifier(context.workflowRunStepId);
  const jobRunId = normalizeIdentifier(context.jobRunId);
  const jobSlug = normalizeIdentifier(context.jobSlug);

  if (!workflowDefinitionId || !workflowRunId || !workflowRunStepId || !jobRunId || !jobSlug) {
    return {
      status: 'invalid',
      reason: 'missing_or_invalid_fields',
      metadata: {
        workflowDefinitionId,
        workflowRunId,
        workflowRunStepId,
        jobRunId,
        jobSlug
      }
    };
  }

  return {
    status: 'valid',
    context: {
      workflowDefinitionId,
      workflowRunId,
      workflowRunStepId,
      jobRunId,
      jobSlug
    }
  };
}

function logInvalidWorkflowMetadata(event: EventEnvelope, result: WorkflowMetadataParseResult): void {
  if (result.status !== 'invalid') {
    return;
  }
  logger.warn(
    'Workflow event metadata missing required workflow context',
    normalizeMeta({
      eventId: event.id,
      type: event.type,
      source: event.source,
      reason: result.reason,
      metadata: result.metadata
    })
  );
}

function logSampleOverflow(record: WorkflowEventProducerSampleRecord): void {
  if (record.sampleCount < SAMPLE_OVERFLOW_WARNING_THRESHOLD) {
    return;
  }
  logger.warn(
    'Workflow event sampling count exceeded threshold',
    normalizeMeta({
      workflowDefinitionId: record.workflowDefinitionId,
      workflowRunStepId: record.workflowRunStepId,
      jobSlug: record.jobSlug,
      eventType: record.eventType,
      eventSource: record.eventSource,
      sampleCount: record.sampleCount,
      threshold: SAMPLE_OVERFLOW_WARNING_THRESHOLD
    })
  );
}

async function recordWorkflowEventSampling(
  record: WorkflowEventRecord,
  envelope: EventEnvelope,
  metadataResult: WorkflowMetadataParseResult
): Promise<void> {
  if (metadataResult.status === 'missing') {
    return;
  }
  if (metadataResult.status === 'invalid') {
    logInvalidWorkflowMetadata(envelope, metadataResult);
    return;
  }

  try {
    const sample = await upsertWorkflowEventProducerSample({
      workflowDefinitionId: metadataResult.context.workflowDefinitionId,
      workflowRunStepId: metadataResult.context.workflowRunStepId,
      jobSlug: metadataResult.context.jobSlug,
      eventType: record.type,
      eventSource: record.source,
      observedAt: record.occurredAt
    });

    logSampleOverflow(sample);
  } catch (err) {
    logger.error(
      'Failed to persist workflow event sampling record',
      normalizeMeta({
        eventId: record.id,
        type: record.type,
        source: record.source,
        workflowDefinitionId: metadataResult.context.workflowDefinitionId,
        workflowRunStepId: metadataResult.context.workflowRunStepId,
        jobSlug: metadataResult.context.jobSlug,
        error: err instanceof Error ? err.message : String(err)
      })
    );
  }
}

export async function ingestWorkflowEvent(envelope: EventEnvelope): Promise<WorkflowEventRecord> {
  const workflowMetadataResult = parseWorkflowMetadata(envelope);
  const record = await insertWorkflowEvent({
    id: envelope.id,
    type: envelope.type,
    source: envelope.source,
    occurredAt: envelope.occurredAt,
    payload: envelope.payload,
    correlationId: envelope.correlationId ?? null,
    ttlMs: envelope.ttl ?? null,
    metadata: envelope.metadata ?? null
  });

  await recordWorkflowEventSampling(record, envelope, workflowMetadataResult);

  logger.info(
    'Workflow event ingested',
    normalizeMeta({
      eventId: record.id,
      type: record.type,
      source: record.source,
      occurredAt: record.occurredAt
    })
  );

  const derived = deriveWorkflowEventSubtype(record);
  if (derived) {
    emitApphubEvent({ type: derived.type, data: derived.payload } as ApphubEvent);
  }
  emitApphubEvent({ type: 'workflow.event.received', data: { event: record } });
  return record;
}

export { getWorkflowEventById };
