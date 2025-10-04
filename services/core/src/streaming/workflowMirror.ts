import { getFeatureFlags } from '../config/featureFlags';
import type { WorkflowRunRecord, WorkflowEventRecord } from '../db/types';
import { logger } from '../observability/logger';
import {
  isKafkaPublisherConfigured,
  publishKafkaMirrorMessage
} from './kafkaPublisher';
import { buildWorkflowEventView } from '../workflowEventInsights';
import { safeStringify, normalizeString } from './utils';

const STREAM_SOURCE = 'core';

function resolveTopic(envValue: string | undefined, fallback: string): string {
  const trimmed = envValue?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

const WORKFLOW_RUN_TOPIC = resolveTopic(
  process.env.APPHUB_STREAM_TOPIC_WORKFLOW_RUNS,
  'apphub.workflows.runs'
);

const WORKFLOW_EVENT_TOPIC = resolveTopic(
  process.env.APPHUB_STREAM_TOPIC_WORKFLOW_EVENTS,
  'apphub.workflows.events'
);

type MirrorKey = 'workflowRuns' | 'workflowEvents';

function isMirrorEnabled(key: MirrorKey): boolean {
  const flags = getFeatureFlags();
  if (!flags.streaming.enabled) {
    return false;
  }
  const enabled = flags.streaming.mirrors[key];
  if (!enabled) {
    return false;
  }
  if (!isKafkaPublisherConfigured()) {
    return false;
  }
  return true;
}

export function mirrorWorkflowRunLifecycle(eventType: string, run: WorkflowRunRecord): void {
  if (!isMirrorEnabled('workflowRuns')) {
    return;
  }

  const emittedAt = new Date().toISOString();
  const row = {
    source: STREAM_SOURCE,
    emittedAt,
    eventType,
    workflowDefinitionId: run.workflowDefinitionId,
    workflowRunId: run.id,
    status: run.status,
    runKey: run.runKey ?? null,
    triggeredBy: run.triggeredBy ?? null,
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
    updatedAt: run.updatedAt ?? null,
    durationMs: run.durationMs ?? null,
    payloadJson: safeStringify(run)
  };

  const headers: Record<string, string> = {
    'x-apphub-event-type': eventType,
    'x-apphub-workflow-definition': run.workflowDefinitionId,
    'x-apphub-workflow-run': run.id
  };

  const published = publishKafkaMirrorMessage({
    topic: WORKFLOW_RUN_TOPIC,
    key: run.id,
    value: row,
    headers
  });

  void published.catch((err) => {
    logger.error('Workflow run mirror publish rejected', {
      error: err instanceof Error ? err.message : String(err),
      workflowRunId: run.id,
      workflowDefinitionId: run.workflowDefinitionId,
      eventType
    });
  });
}

export function mirrorWorkflowEventRecord(record: WorkflowEventRecord): void {
  if (!isMirrorEnabled('workflowEvents')) {
    return;
  }

  const view = buildWorkflowEventView(record);

  const emittedAt = record.receivedAt;

  const context = extractWorkflowMetadata(record.metadata);

  const row = {
    source: STREAM_SOURCE,
    emittedAt,
    eventType: record.type,
    eventSource: record.source,
    workflowEventId: record.id,
    occurredAt: record.occurredAt,
    receivedAt: record.receivedAt,
    correlationId: record.correlationId ?? null,
    severity: view.severity,
    workflowDefinitionId: context?.workflowDefinitionId ?? null,
    workflowRunId: context?.workflowRunId ?? null,
    workflowRunStepId: context?.workflowRunStepId ?? null,
    jobRunId: context?.jobRunId ?? null,
    jobSlug: context?.jobSlug ?? null,
    workflowRunKey: context?.workflowRunKey ?? null,
    derivedType: view.derived?.type ?? null,
    payloadJson: safeStringify(record.payload ?? null),
    metadataJson: safeStringify(record.metadata ?? null),
    derivedPayloadJson: view.derived ? safeStringify(view.derived.payload ?? null) : null,
    linksJson: safeStringify(view.links)
  };

  const headers: Record<string, string> = {
    'x-apphub-event-type': record.type,
    'x-apphub-workflow-event-id': record.id
  };

  const published = publishKafkaMirrorMessage({
    topic: WORKFLOW_EVENT_TOPIC,
    key: record.id,
    value: row,
    headers
  });

  void published.catch((err) => {
    logger.error('Workflow event mirror publish rejected', {
      error: err instanceof Error ? err.message : String(err),
      workflowEventId: record.id,
      workflowEventType: record.type
    });
  });
}

type WorkflowEventMirrorContext = {
  workflowDefinitionId: string | null;
  workflowRunId: string | null;
  workflowRunStepId: string | null;
  jobRunId: string | null;
  jobSlug: string | null;
  workflowRunKey: string | null;
};

function extractWorkflowMetadata(metadata: unknown): WorkflowEventMirrorContext | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const raw = (metadata as Record<string, unknown>)['__apphubWorkflow'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const context = raw as Record<string, unknown>;
  return {
    workflowDefinitionId: normalizeString(context.workflowDefinitionId),
    workflowRunId: normalizeString(context.workflowRunId),
    workflowRunStepId: normalizeString(context.workflowRunStepId),
    jobRunId: normalizeString(context.jobRunId),
    jobSlug: normalizeString(context.jobSlug),
    workflowRunKey: normalizeString(context.workflowRunKey)
  } satisfies WorkflowEventMirrorContext;
}
