import { getFeatureFlags } from '../config/featureFlags';
import type { ApphubEvent } from '../events';
import type { JobRunRecord, IngestionEvent, WorkflowEventRecord } from '../db/types';
import { logger } from '../observability/logger';
import {
  isKafkaPublisherConfigured,
  publishKafkaMirrorMessage,
  type KafkaMirrorMessage
} from './kafkaPublisher';
import { safeStringify } from './utils';

const STREAM_SOURCE = 'core';

function resolveTopic(envValue: string | undefined, fallback: string): string {
  const trimmed = envValue?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

const CORE_EVENT_TOPIC = resolveTopic(
  process.env.APPHUB_STREAM_TOPIC_CORE_EVENTS,
  'apphub.core.events'
);

let publishMirrorMessage: (message: KafkaMirrorMessage) => Promise<boolean> = publishKafkaMirrorMessage;
let isKafkaConfigured: () => boolean = isKafkaPublisherConfigured;

const JOB_RUN_TOPIC = resolveTopic(
  process.env.APPHUB_STREAM_TOPIC_JOB_RUNS,
  'apphub.jobs.runs'
);

const INGESTION_TOPIC = resolveTopic(
  process.env.APPHUB_STREAM_TOPIC_INGESTION,
  'apphub.ingestion.telemetry'
);

function isJobRunEvent(event: ApphubEvent): event is Extract<ApphubEvent, { data: { run: JobRunRecord } }> {
  return event.type.startsWith('job.run.') && Boolean((event.data as { run?: JobRunRecord }).run);
}

function isIngestionEvent(event: ApphubEvent): event is Extract<ApphubEvent, { data: { event: IngestionEvent } }> {
  return event.type === 'repository.ingestion-event' && Boolean((event.data as { event?: IngestionEvent }).event);
}

function shouldMirrorCoreEvent(event: ApphubEvent): boolean {
  if (event.type.startsWith('workflow.')) {
    return false;
  }
  if (event.type.startsWith('job.run.')) {
    return false;
  }
  if (event.type === 'repository.ingestion-event') {
    return false;
  }
  return true;
}

function publishWithLogging(
  topic: string,
  key: string | undefined,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
  options: { timestamp?: string | Date } = {}
): void {
  const timestampOption = (() => {
    if (!options.timestamp) {
      return undefined;
    }
    if (options.timestamp instanceof Date) {
      return options.timestamp;
    }
    const parsed = new Date(options.timestamp);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  })();

  const send = publishMirrorMessage({
    topic,
    key,
    value: payload,
    headers,
    ...(timestampOption ? { timestamp: timestampOption } : {})
  });

  void send.catch((err) => {
    const eventType = typeof payload.type === 'string' ? payload.type : null;
    logger.error('Streaming mirror publish failed', {
      error: err instanceof Error ? err.message : String(err),
      topic,
      eventType
    });
  });
}

export function mirrorApphubEvent(event: ApphubEvent): void {
  const flags = getFeatureFlags();
  if (!flags.streaming.enabled) {
    return;
  }
  if (!isKafkaConfigured()) {
    return;
  }

  const emittedAt = new Date().toISOString();

  if (isJobRunEvent(event)) {
    if (!flags.streaming.mirrors.jobRuns) {
      return;
    }
    const run = event.data.run;
    publishWithLogging(
      JOB_RUN_TOPIC,
      run.id,
      {
        source: STREAM_SOURCE,
        emittedAt,
        eventType: event.type,
        jobDefinitionId: run.jobDefinitionId,
        jobRunId: run.id,
        status: run.status,
        attempt: run.attempt,
        retryCount: run.retryCount,
        scheduledAt: run.scheduledAt,
        startedAt: run.startedAt ?? null,
        completedAt: run.completedAt ?? null,
        updatedAt: run.updatedAt,
        durationMs: run.durationMs ?? null,
        failureReason: run.failureReason ?? null,
        payloadJson: safeStringify(run)
      },
      {
        'x-apphub-event-type': event.type,
        'x-apphub-job-definition': run.jobDefinitionId,
        'x-apphub-job-run': run.id
      },
      { timestamp: emittedAt }
    );
    return;
  }

  if (isIngestionEvent(event)) {
    if (!flags.streaming.mirrors.ingestion) {
      return;
    }
    const ingestion = event.data.event;
    publishWithLogging(
      INGESTION_TOPIC,
      `${ingestion.repositoryId}:${ingestion.id}`,
      {
        source: STREAM_SOURCE,
        emittedAt,
        eventType: event.type,
        ingestionId: ingestion.id,
        repositoryId: ingestion.repositoryId,
        status: ingestion.status,
        attempt: ingestion.attempt ?? null,
        commitSha: ingestion.commitSha ?? null,
        durationMs: ingestion.durationMs ?? null,
        message: ingestion.message ?? null,
        createdAt: ingestion.createdAt,
        payloadJson: safeStringify(ingestion)
      },
      {
        'x-apphub-event-type': event.type,
        'x-apphub-repository-id': ingestion.repositoryId,
        'x-apphub-ingestion-id': ingestion.id.toString()
      },
      { timestamp: emittedAt }
    );
    return;
  }

  if (!flags.streaming.mirrors.coreEvents) {
    return;
  }

  if (!shouldMirrorCoreEvent(event)) {
    return;
  }

  publishWithLogging(
    CORE_EVENT_TOPIC,
    undefined,
    {
      source: STREAM_SOURCE,
      emittedAt,
      eventType: event.type,
      payloadJson: safeStringify(event.data)
    },
    {
      'x-apphub-event-type': event.type
    },
    { timestamp: emittedAt }
  );
}

function shouldMirrorCustomWorkflowEvent(record: WorkflowEventRecord): boolean {
  if (!record.type || typeof record.type !== 'string') {
    return false;
  }
  if (!record.source || typeof record.source !== 'string') {
    return false;
  }

  const flags = getFeatureFlags();
  if (!flags.streaming.enabled) {
    return false;
  }
  if (!flags.streaming.mirrors.coreEvents) {
    return false;
  }
  if (!isKafkaConfigured()) {
    return false;
  }

  return true;
}

export function mirrorCustomWorkflowEvent(record: WorkflowEventRecord): void {
  if (!shouldMirrorCustomWorkflowEvent(record)) {
    return;
  }

  const emittedAt = record.receivedAt ?? new Date().toISOString();
  const headers: Record<string, string> = {
    'x-apphub-event-type': record.type,
    'x-apphub-workflow-event-id': record.id,
    'x-apphub-ingress-sequence': record.ingressSequence
  };

  publishWithLogging(
    CORE_EVENT_TOPIC,
    record.id,
    {
      source: STREAM_SOURCE,
      emittedAt,
      eventType: record.type,
      ingressSequence: record.ingressSequence,
      occurredAt: record.occurredAt,
      receivedAt: record.receivedAt,
      correlationId: record.correlationId,
      payloadJson: safeStringify(record.payload ?? null),
      metadataJson: safeStringify(record.metadata ?? null)
    },
    headers
    ,
    { timestamp: emittedAt }
  );
}

export function __setCoreMirrorTestOverrides(overrides?: {
  publishKafkaMirrorMessage?: (message: KafkaMirrorMessage) => Promise<boolean>;
  isKafkaPublisherConfigured?: () => boolean;
}): void {
  publishMirrorMessage = overrides?.publishKafkaMirrorMessage ?? publishKafkaMirrorMessage;
  isKafkaConfigured = overrides?.isKafkaPublisherConfigured ?? isKafkaPublisherConfigured;
}
