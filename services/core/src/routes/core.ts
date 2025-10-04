import { Buffer } from 'node:buffer';
import type { FastifyInstance } from 'fastify';
import WebSocket, { type RawData } from 'ws';
import { z } from 'zod';
import { normalizeEventEnvelope, type EventEnvelopeInput } from '@apphub/event-bus';
import { computeRunMetrics } from '../observability/metrics';
import { getPrometheusMetrics, getPrometheusContentType } from '../observability/queueTelemetry';
import { subscribeToApphubEvents, type ApphubEvent } from '../events';
import { enqueueWorkflowEvent } from '../queue';
import type { FeatureFlags } from '../config/featureFlags';
import { evaluateStreamingStatus } from '../streaming/status';
import {
  serializeBuild,
  serializeLaunch,
  serializeRepository,
  serializeService,
  serializeWorkflowDefinition,
  serializeWorkflowRun,
  type SerializedBuild,
  type SerializedLaunch,
  type SerializedRepository,
  type SerializedService,
  type SerializedWorkflowDefinition,
  type SerializedWorkflowRun
} from './shared/serializers';
import type { IngestionEvent } from '../db/index';
import {
  type AssetExpiredEventData,
  type AssetProducedEventData,
  type MetastoreRecordEventData,
  type TimestoreDatasetExportCompletedEventData,
  type TimestorePartitionCreatedEventData,
  type TimestorePartitionDeletedEventData,
  type WorkflowEventRecordView
} from '@apphub/shared/coreEvents';
import type { FilestoreEvent } from '@apphub/shared/filestoreEvents';
import { buildWorkflowEventView } from '../workflowEventInsights';
import { schemaRef } from '../openapi/definitions';

type WorkflowAnalyticsSnapshotData = Extract<
  ApphubEvent,
  { type: 'workflow.analytics.snapshot' }
>['data'];

type WorkflowRunEventType =
  | 'workflow.run.updated'
  | 'workflow.run.pending'
  | 'workflow.run.running'
  | 'workflow.run.succeeded'
  | 'workflow.run.failed'
  | 'workflow.run.canceled';

const eventPublishRequestSchema = z
  .object({
    id: z.string().uuid().optional(),
    type: z.string().min(1, 'type is required'),
    source: z.string().min(1, 'source is required'),
    occurredAt: z.union([z.string(), z.date()]).optional(),
    payload: z.unknown().optional(),
    metadata: z.unknown().optional(),
    correlationId: z.string().min(1).optional(),
    ttlSeconds: z.number().int().positive().optional(),
    ttl: z.number().int().positive().optional()
  })
  .passthrough();

type OutboundEvent =
  | { type: 'repository.updated'; data: { repository: SerializedRepository } }
  | { type: 'repository.ingestion-event'; data: { event: IngestionEvent } }
  | { type: 'build.updated'; data: { build: SerializedBuild } }
  | { type: 'launch.updated'; data: { repositoryId: string; launch: SerializedLaunch } }
  | { type: 'service.updated'; data: { service: SerializedService } }
  | { type: 'workflow.definition.updated'; data: { workflow: SerializedWorkflowDefinition } }
  | { type: WorkflowRunEventType; data: { run: SerializedWorkflowRun } }
  | { type: 'workflow.analytics.snapshot'; data: WorkflowAnalyticsSnapshotData }
  | { type: 'workflow.event.received'; data: { event: WorkflowEventRecordView } }
  | { type: 'asset.produced'; data: AssetProducedEventData }
  | { type: 'asset.expired'; data: AssetExpiredEventData }
  | { type: 'metastore.record.created'; data: MetastoreRecordEventData }
  | { type: 'metastore.record.updated'; data: MetastoreRecordEventData }
  | { type: 'metastore.record.deleted'; data: MetastoreRecordEventData }
  | FilestoreEvent
  | { type: 'timestore.partition.created'; data: TimestorePartitionCreatedEventData }
  | { type: 'timestore.partition.deleted'; data: TimestorePartitionDeletedEventData }
  | { type: 'timestore.dataset.export.completed'; data: TimestoreDatasetExportCompletedEventData }
  | {
      type: 'retry.event.source.cancelled';
      data: Extract<ApphubEvent, { type: 'retry.event.source.cancelled' }>['data'];
    }
  | {
      type: 'retry.event.source.forced';
      data: Extract<ApphubEvent, { type: 'retry.event.source.forced' }>['data'];
    }
  | {
      type: 'retry.trigger.delivery.cancelled';
      data: Extract<ApphubEvent, { type: 'retry.trigger.delivery.cancelled' }>['data'];
    }
  | {
      type: 'retry.trigger.delivery.forced';
      data: Extract<ApphubEvent, { type: 'retry.trigger.delivery.forced' }>['data'];
    }
  | {
      type: 'retry.workflow.step.cancelled';
      data: Extract<ApphubEvent, { type: 'retry.workflow.step.cancelled' }>['data'];
    }
  | {
      type: 'retry.workflow.step.forced';
      data: Extract<ApphubEvent, { type: 'retry.workflow.step.forced' }>['data'];
    };

function toOutboundEvent(event: ApphubEvent): OutboundEvent | null {
  if (event.type.startsWith('filestore.')) {
    return event as FilestoreEvent;
  }
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
    case 'workflow.analytics.snapshot':
      return {
        type: 'workflow.analytics.snapshot',
        data: event.data
      };
    case 'workflow.event.received':
      return {
        type: 'workflow.event.received',
        data: { event: buildWorkflowEventView(event.data.event) }
      };
    case 'asset.produced':
    case 'asset.expired':
    case 'metastore.record.created':
    case 'metastore.record.updated':
    case 'metastore.record.deleted':
    case 'timestore.partition.created':
    case 'timestore.partition.deleted':
    case 'timestore.dataset.export.completed':
      return event;
    case 'retry.event.source.cancelled':
    case 'retry.event.source.forced':
    case 'retry.trigger.delivery.cancelled':
    case 'retry.trigger.delivery.forced':
    case 'retry.workflow.step.cancelled':
    case 'retry.workflow.step.forced':
      return event;
    default:
      return null;
  }
}

type CoreRouteOptions = {
  featureFlags: FeatureFlags;
};

export async function registerCoreRoutes(
  app: FastifyInstance,
  options: CoreRouteOptions
): Promise<void> {
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

  app.post('/v1/events', async (request, reply) => {
    const parsed = eventPublishRequestSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      reply.status(400);
      return { error: parsed.error.flatten() };
    }

    const { ttlSeconds, ttl, payload, metadata, ...rest } = parsed.data;

    const envelopeInput: EventEnvelopeInput = {
      id: rest.id,
      type: rest.type,
      source: rest.source,
      occurredAt: rest.occurredAt,
      payload: (payload ?? {}) as EventEnvelopeInput['payload'],
      metadata: metadata as Record<string, unknown> | undefined,
      correlationId: rest.correlationId,
      ttl: typeof ttl === 'number' ? ttl : ttlSeconds
    };

    let envelope;
    try {
      envelope = normalizeEventEnvelope(envelopeInput);
    } catch (err) {
      reply.status(400);
      return { error: err instanceof Error ? err.message : 'Invalid event payload.' };
    }

    try {
      const queued = await enqueueWorkflowEvent(envelope);
      reply.status(202);
      return {
        data: {
          acceptedAt: new Date().toISOString(),
          event: queued
        }
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to enqueue workflow event');
      reply.status(502);
      return { error: 'Failed to enqueue workflow event.' };
    }
  });

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
        // ignore socket close errors
      }
    }
    sockets.clear();
  });

  app.get('/ws', { websocket: true }, (socket) => {
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

  app.get(
    '/health',
    {
      schema: {
        tags: ['System'],
        summary: 'Readiness probe',
        description: 'Returns feature flag state and streaming readiness.',
        response: {
          200: {
            description: 'The API is healthy and streaming (if enabled) is ready.',
            content: {
              'application/json': {
                schema: schemaRef('HealthResponse')
              }
            }
          },
          503: {
            description: 'Streaming is enabled but not ready.',
            content: {
              'application/json': {
                schema: schemaRef('HealthUnavailableResponse')
              }
            }
          }
        }
      }
    },
    async (_request, reply) => {
      const streamingStatus = await evaluateStreamingStatus(options.featureFlags);
      const streamingReady = !streamingStatus.enabled || streamingStatus.state === 'ready';
      if (!streamingReady) {
        reply.status(503);
        return {
          status: 'unavailable',
          warnings: streamingStatus.reason ? [streamingStatus.reason] : [],
          features: {
            streaming: streamingStatus
          }
        };
      }

      return {
        status: 'ok',
        warnings: streamingStatus.reason ? [streamingStatus.reason] : [],
        features: {
          streaming: streamingStatus
        }
      };
    }
  );

  app.get(
    '/readyz',
    {
      schema: {
        tags: ['System'],
        summary: 'Readiness probe',
        description: 'Aggregates streaming readiness when the feature flag is enabled.',
        response: {
          200: {
            description: 'Core services are ready to receive traffic.',
            content: {
              'application/json': {
                schema: schemaRef('ReadyResponse')
              }
            }
          },
          503: {
            description: 'Streaming components are not ready.',
            content: {
              'application/json': {
                schema: schemaRef('ReadyUnavailableResponse')
              }
            }
          }
        }
      }
    },
    async (_request, reply) => {
      const streamingStatus = await evaluateStreamingStatus(options.featureFlags);
      const streamingReady = !streamingStatus.enabled || streamingStatus.state === 'ready';
      if (!streamingReady) {
        reply.status(503);
        return {
          status: 'unavailable',
          warnings: streamingStatus.reason ? [streamingStatus.reason] : [],
          features: {
            streaming: streamingStatus
          }
        };
      }
      reply.status(200);
      return {
        status: 'ready',
        warnings: streamingStatus.reason ? [streamingStatus.reason] : [],
        features: {
          streaming: streamingStatus
        }
      };
    }
  );

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

  app.get('/metrics/prometheus', async (_request, reply) => {
    const metrics = await getPrometheusMetrics();
    reply.header('Content-Type', getPrometheusContentType());
    reply.status(200).send(metrics);
  });
}
