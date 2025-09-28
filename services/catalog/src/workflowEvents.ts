import type { EventEnvelope } from '@apphub/event-bus';
import { insertWorkflowEvent, getWorkflowEventById } from './db/workflowEvents';
import type { WorkflowEventRecord } from './db/types';
import { emitApphubEvent } from './events';
import { logger } from './observability/logger';
import { normalizeMeta } from './observability/meta';

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

  emitApphubEvent({ type: 'workflow.event.received', data: { event: record } });
  return record;
}

export { getWorkflowEventById };
