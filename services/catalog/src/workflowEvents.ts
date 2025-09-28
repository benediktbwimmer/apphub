import type { EventEnvelope } from '@apphub/event-bus';
import { insertWorkflowEvent, getWorkflowEventById } from './db/workflowEvents';
import type { WorkflowEventRecord } from './db/types';
import { emitApphubEvent, type ApphubEvent } from './events';
import { logger } from './observability/logger';
import { normalizeMeta } from './observability/meta';
import { deriveWorkflowEventSubtype } from './workflowEventInsights';

export async function ingestWorkflowEvent(envelope: EventEnvelope): Promise<WorkflowEventRecord> {
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
