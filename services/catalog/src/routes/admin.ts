import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ensureDatabase,
  listWorkflowEvents,
  markDatabaseUninitialized,
  nukeCatalogDatabase,
  nukeCatalogEverything,
  nukeCatalogRunData
} from '../db/index';
import { resetServiceManifestState } from '../serviceRegistry';
import {
  getEventQueueStats,
  getEventTriggerQueueStats,
  getQueueHealthSnapshot,
  getQueueKeyStatistics,
  removeEventRetryJob,
  removeEventTriggerRetryJob,
  removeWorkflowRetryJob,
  scheduleEventRetryJob,
  scheduleEventTriggerRetryJob,
  scheduleWorkflowRetryJob
} from '../queue';
import { getEventSchedulerMetricsSnapshot } from '../eventSchedulerMetrics';
import {
  getSourcePauseStates,
  getTriggerPauseStates,
  getRateLimitConfiguration
} from '../eventSchedulerState';

import { buildWorkflowEventSchema } from '../eventSchemaExplorer';
import { getRetryBacklogSnapshot } from '../retryBacklog';
import {
  deleteEventIngressRetry,
  getEventIngressRetryById,
  updateEventIngressRetry
} from '../db/eventIngressRetries';
import type { JsonValue } from '../db/types';
import {
  getWorkflowTriggerDeliveryById,
  getWorkflowRunStepById,
  updateWorkflowRunStep,
  updateWorkflowTriggerDelivery
} from '../db/workflows';
import { emitApphubEvent } from '../events';
import { getWorkflowEventById } from '../workflowEvents';
import { buildWorkflowEventView } from '../workflowEventInsights';
import { decodeWorkflowEventCursor, encodeWorkflowEventCursor } from '../workflowEventCursor';
import { requireOperatorScopes } from './shared/operatorAuth';
import { RUNTIME_SCALING_WRITE_SCOPES, WORKFLOW_RUN_SCOPES } from './shared/scopes';
import { getWorkflowSchedulerMetricsSnapshot } from '../workflowSchedulerMetrics';
import { getWorkflowEventProducerSamplingSnapshot } from '../db/workflowEventSamples';
import { replayWorkflowEventSampling } from '../eventSamplingReplay';
import {
  listRuntimeScalingAcknowledgements,
  type RuntimeScalingAcknowledgementRecord
} from '../db/runtimeScaling';
import {
  resolveAllRuntimeScalingSnapshots,
  updateRuntimeScalingPolicy,
  RuntimeScalingRateLimitError,
  RuntimeScalingValidationError,
  isRuntimeScalingWriteEnabled
} from '../runtimeScaling/policies';
import type { RuntimeScalingSnapshot } from '../runtimeScaling/policies';
import { getRuntimeScalingTarget, type RuntimeScalingTargetKey } from '../runtimeScaling/targets';
import { publishRuntimeScalingUpdate } from '../runtimeScaling/notifications';

const DEFAULT_SAMPLING_STALE_MINUTES = normalizePositiveNumber(
  process.env.EVENT_SAMPLING_STALE_MINUTES,
  6 * 60
);

const RUNTIME_SCALING_ACK_LIMIT = 20;

function normalizePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseLimitParam(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const normalized = Math.floor(parsed);
  if (normalized <= 0) {
    return undefined;
  }
  return normalized;
}

function computeStaleBefore(
  isoCandidate: string | undefined,
  minutesCandidate: string | undefined
): string | null {
  const trimmedIso = isoCandidate?.trim();
  if (trimmedIso) {
    const parsed = Date.parse(trimmedIso);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  if (minutesCandidate !== undefined) {
    const parsedMinutes = Number(minutesCandidate);
    if (Number.isFinite(parsedMinutes)) {
      if (parsedMinutes <= 0) {
        return null;
      }
      const durationMs = Math.floor(parsedMinutes) * 60_000;
      return new Date(Date.now() - durationMs).toISOString();
    }
  }

  if (DEFAULT_SAMPLING_STALE_MINUTES <= 0) {
    return null;
  }
  return new Date(Date.now() - DEFAULT_SAMPLING_STALE_MINUTES * 60_000).toISOString();
}

type RuntimeScalingQueueSnapshot = {
  name: string;
  mode: 'inline' | 'queue';
  counts: Record<string, number>;
  metrics: {
    processingAvgMs?: number | null;
    waitingAvgMs?: number | null;
  } | null;
  error: string | null;
};

type RuntimeScalingTargetPayload = {
  target: string;
  displayName: string;
  description: string;
  desiredConcurrency: number;
  effectiveConcurrency: number;
  defaultConcurrency: number;
  minConcurrency: number;
  maxConcurrency: number;
  rateLimitMs: number;
  defaultEnvVar: string;
  source: 'policy' | 'default';
  reason: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  updatedByKind: 'user' | 'service' | null;
  policyMetadata: JsonValue | null;
  queue: RuntimeScalingQueueSnapshot;
  acknowledgements: Array<{
    instanceId: string;
    appliedConcurrency: number;
    status: RuntimeScalingAcknowledgementRecord['status'];
    error: string | null;
    updatedAt: string;
  }>;
};

function normalizeQueueCounts(counts?: Record<string, number>): Record<string, number> {
  if (!counts) {
    return {};
  }
  const normalized: Record<string, number> = {};
  for (const [state, value] of Object.entries(counts)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      normalized[state] = value;
    }
  }
  return normalized;
}

function normalizeAcknowledgements(
  entries: RuntimeScalingAcknowledgementRecord[]
): RuntimeScalingTargetPayload['acknowledgements'] {
  return entries.map((entry) => ({
    instanceId: entry.instanceId,
    appliedConcurrency: entry.appliedConcurrency,
    status: entry.status,
    error: entry.error ?? null,
    updatedAt: entry.updatedAt
  }));
}

async function buildRuntimeScalingTargetPayload(
  snapshot: RuntimeScalingSnapshot,
  request: FastifyRequest
): Promise<RuntimeScalingTargetPayload> {
  const config = getRuntimeScalingTarget(snapshot.target);

  let queueError: string | null = null;
  let queueName = config.queueName;
  let queueMode: 'inline' | 'queue' = 'queue';
  let queueCounts: Record<string, number> = {};
  let queueMetrics: RuntimeScalingQueueSnapshot['metrics'] = null;

  try {
    const stats = await getQueueKeyStatistics(config.queueKey);
    queueName = stats.queueName;
    queueMode = stats.mode;
    queueCounts = stats.mode === 'queue' ? normalizeQueueCounts(stats.counts) : {};
    queueMetrics = stats.mode === 'queue' ? stats.metrics ?? null : null;
  } catch (err) {
    queueError = err instanceof Error ? err.message : String(err);
    request.log.warn({ err, target: snapshot.target }, 'Failed to collect queue statistics for runtime scaling');
  }

  const acknowledgements = await listRuntimeScalingAcknowledgements(snapshot.target);

  return {
    target: snapshot.target,
    displayName: config.displayName,
    description: config.description,
    desiredConcurrency: snapshot.desiredConcurrency,
    effectiveConcurrency: snapshot.effectiveConcurrency,
    defaultConcurrency: snapshot.defaultConcurrency,
    minConcurrency: config.minConcurrency,
    maxConcurrency: config.maxConcurrency,
    rateLimitMs: config.rateLimitMs,
    defaultEnvVar: config.defaultEnvVar,
    source: snapshot.source,
    reason: snapshot.reason,
    updatedAt: snapshot.updatedAt,
    updatedBy: snapshot.updatedBy,
    updatedByKind: snapshot.updatedByKind,
    policyMetadata: snapshot.policy?.metadata ?? null,
    queue: {
      name: queueName,
      mode: queueMode,
      counts: queueCounts,
      metrics: queueMetrics,
      error: queueError
    },
    acknowledgements: normalizeAcknowledgements(acknowledgements.slice(0, RUNTIME_SCALING_ACK_LIMIT))
  } satisfies RuntimeScalingTargetPayload;
}

function mergeMetadata(existing: JsonValue | null | undefined, patch: Record<string, unknown>): JsonValue {
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return { ...(existing as Record<string, unknown>), ...patch } as JsonValue;
  }
  return patch as JsonValue;
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/admin/event-health', async (request, reply) => {
    try {
      const [
        ingressQueue,
        triggerQueue,
        metricsSnapshot,
        pausedSources,
        pausedTriggers,
        retrySnapshot
      ] = await Promise.all([
        getEventQueueStats(),
        getEventTriggerQueueStats(),
        getEventSchedulerMetricsSnapshot(),
        getSourcePauseStates(),
        getTriggerPauseStates(),
        getRetryBacklogSnapshot()
      ]);

      reply.status(200).send({
        data: {
          queues: {
            ingress: ingressQueue,
            triggers: triggerQueue
          },
          metrics: metricsSnapshot,
          pausedSources,
          pausedTriggers,
          rateLimits: getRateLimitConfiguration(),
          retries: retrySnapshot,
          workflowScheduler: getWorkflowSchedulerMetricsSnapshot()
        }
      });
    } catch (err) {
      request.log.error({ err }, 'Failed to collect event health');
      reply.status(500).send({ error: 'Failed to collect event health' });
    }
  });

  app.get('/admin/runtime-scaling', async (request, reply) => {
    try {
      const snapshots = await resolveAllRuntimeScalingSnapshots();
      const targets = await Promise.all(
        snapshots.map((snapshot) => buildRuntimeScalingTargetPayload(snapshot, request))
      );

      reply.status(200).send({
        data: {
          targets,
          writesEnabled: isRuntimeScalingWriteEnabled()
        }
      });
    } catch (err) {
      request.log.error({ err }, 'Failed to collect runtime scaling state');
      reply.status(500).send({ error: 'Failed to load runtime scaling state' });
    }
  });

  app.post<{
    Params: { target: string };
    Body: { desiredConcurrency?: number; reason?: string | null };
  }>('/admin/runtime-scaling/:target', async (request, reply) => {
    const targetParam = request.params.target?.trim();
    if (!targetParam) {
      reply.status(400).send({ error: 'Runtime scaling target is required' });
      return;
    }

    let targetConfig: ReturnType<typeof getRuntimeScalingTarget>;
    try {
      targetConfig = getRuntimeScalingTarget(targetParam as RuntimeScalingTargetKey);
    } catch (err) {
      reply.status(404).send({ error: 'Unknown runtime scaling target' });
      return;
    }

    const normalizedTarget: RuntimeScalingTargetKey = targetConfig.key;

    const authResult = await requireOperatorScopes(request, reply, {
      action: 'runtime-scaling.update',
      resource: normalizedTarget,
      requiredScopes: RUNTIME_SCALING_WRITE_SCOPES
    });

    if (!authResult.ok) {
      return;
    }

    if (!isRuntimeScalingWriteEnabled()) {
      await authResult.auth.log('failed', {
        reason: 'writes_disabled',
        target: normalizedTarget
      });
      reply.status(403).send({ error: 'Runtime scaling updates are disabled for this environment.' });
      return;
    }

    const desiredInput = request.body?.desiredConcurrency;
    const desiredValue = typeof desiredInput === 'number' ? desiredInput : Number(desiredInput);
    if (!Number.isFinite(desiredValue)) {
      await authResult.auth.log('failed', {
        reason: 'invalid_desired_concurrency',
        target: normalizedTarget
      });
      reply.status(400).send({ error: 'desiredConcurrency must be a finite number.' });
      return;
    }

    let reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : null;
    if (reason === '') {
      reason = null;
    }

    try {
      const result = await updateRuntimeScalingPolicy({
        target: normalizedTarget,
        desiredConcurrency: desiredValue,
        reason,
        actor: {
          subject: authResult.auth.identity.subject,
          kind: authResult.auth.identity.kind,
          tokenHash: authResult.auth.identity.tokenHash
        }
      });

      await publishRuntimeScalingUpdate({
        type: 'policy:update',
        target: result.snapshot.target,
        desiredConcurrency: result.snapshot.desiredConcurrency,
        updatedAt: result.snapshot.updatedAt ?? new Date().toISOString()
      });

      await authResult.auth.log('succeeded', {
        action: 'runtime-scaling.update',
        target: result.snapshot.target,
        desiredConcurrency: result.snapshot.desiredConcurrency,
        previousConcurrency: result.previousPolicy?.desiredConcurrency ?? null,
        reason: result.snapshot.reason ?? null
      });

      const payload = await buildRuntimeScalingTargetPayload(result.snapshot, request);

      reply.status(200).send({
        data: payload,
        writesEnabled: isRuntimeScalingWriteEnabled()
      });
    } catch (err) {
      if (err instanceof RuntimeScalingRateLimitError) {
        await authResult.auth.log('failed', {
          reason: 'rate_limited',
          target: normalizedTarget,
          retryAfterMs: err.retryAfterMs
        });
        reply.status(429).send({ error: err.message, retryAfterMs: err.retryAfterMs });
        return;
      }

      if (err instanceof RuntimeScalingValidationError) {
        await authResult.auth.log('failed', {
          reason: 'validation_error',
          target: normalizedTarget,
          message: err.message
        });
        reply.status(400).send({ error: err.message });
        return;
      }

      request.log.error({ err, target: normalizedTarget }, 'Failed to update runtime scaling policy');
      await authResult.auth.log('failed', {
        reason: 'unknown_error',
        target: normalizedTarget,
        message: err instanceof Error ? err.message : 'unknown error'
      });
      reply.status(500).send({ error: 'Failed to update runtime scaling policy' });
    }
  });

  app.get<{
    Querystring: {
      perJobLimit?: string;
      staleBefore?: string;
      staleBeforeMinutes?: string;
      staleLimit?: string;
    };
  }>('/admin/event-sampling', async (request, reply) => {
    try {
      const perJobLimit = parseLimitParam(request.query.perJobLimit);
      const staleLimit = parseLimitParam(request.query.staleLimit);
      const staleBefore = computeStaleBefore(
        request.query.staleBefore,
        request.query.staleBeforeMinutes
      );

      const snapshot = await getWorkflowEventProducerSamplingSnapshot({
        perJobLimit,
        staleBefore,
        staleLimit
      });

      reply.status(200).send({ data: snapshot });
    } catch (err) {
      request.log.error({ err }, 'Failed to collect workflow event sampling snapshot');
      reply.status(500).send({ error: 'Failed to collect event sampling snapshot' });
    }
  });

  app.get('/admin/queue-health', async (request, reply) => {
    try {
      const snapshot = await getQueueHealthSnapshot();
      reply.status(200).send({ data: snapshot });
    } catch (err) {
      request.log.error({ err }, 'Failed to collect queue health');
      reply.status(500).send({ error: 'Failed to collect queue health' });
    }
  });

  app.post<{
    Body: {
      lookbackMinutes?: number;
      limit?: number;
      maxAttempts?: number;
      includeProcessed?: boolean;
      dryRun?: boolean;
    };
  }>('/admin/event-sampling/replay', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'event-sampling.replay',
      resource: 'workflows',
      requiredScopes: WORKFLOW_RUN_SCOPES
    });

    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const payload = request.body ?? {};

    const lookbackMinutes = payload.lookbackMinutes;
    if (lookbackMinutes !== undefined) {
      if (!Number.isFinite(lookbackMinutes) || lookbackMinutes <= 0) {
        reply.status(400);
        await authResult.auth.log('failed', { reason: 'invalid_lookback_minutes' });
        return { error: 'lookbackMinutes must be a positive number' };
      }
    }

    const limit = payload.limit;
    if (limit !== undefined) {
      if (!Number.isFinite(limit) || limit <= 0) {
        reply.status(400);
        await authResult.auth.log('failed', { reason: 'invalid_limit' });
        return { error: 'limit must be a positive number' };
      }
    }

    const maxAttempts = payload.maxAttempts;
    if (maxAttempts !== undefined) {
      if (!Number.isFinite(maxAttempts) || maxAttempts <= 0) {
        reply.status(400);
        await authResult.auth.log('failed', { reason: 'invalid_max_attempts' });
        return { error: 'maxAttempts must be a positive number' };
      }
    }

    try {
      const summary = await replayWorkflowEventSampling({
        lookbackMs:
          lookbackMinutes && Number.isFinite(lookbackMinutes)
            ? Math.floor(lookbackMinutes) * 60_000
            : undefined,
        limit: limit && Number.isFinite(limit) ? Math.floor(limit) : undefined,
        maxAttempts:
          maxAttempts && Number.isFinite(maxAttempts) ? Math.floor(maxAttempts) : undefined,
        includeProcessed: Boolean(payload.includeProcessed),
        dryRun: Boolean(payload.dryRun)
      });

      await authResult.auth.log('succeeded', {
        dryRun: summary.dryRun,
        processed: summary.processed
      });

      reply.status(200).send({ data: summary });
    } catch (err) {
      request.log.error({ err }, 'Failed to replay workflow event sampling');
      await authResult.auth.log('failed', { reason: 'replay_failed' });
      reply.status(500).send({ error: 'Failed to replay event sampling' });
    }
  });

  app.post<{ Params: { eventId: string } }>('/admin/retries/events/:eventId/cancel', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'retries.events.cancel',
      resource: 'workflows',
      requiredScopes: WORKFLOW_RUN_SCOPES
    });

    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const eventId = request.params.eventId?.trim();
    if (!eventId) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'missing_event_id' });
      return { error: 'eventId is required' };
    }

    try {
      const retry = await getEventIngressRetryById(eventId);
      if (!retry || retry.retryState !== 'scheduled') {
        reply.status(404);
        await authResult.auth.log('failed', {
          reason: 'event_retry_not_found',
          eventId
        });
        return { error: 'event retry not found' };
      }

      const cancelledAt = new Date().toISOString();
      const metadata = mergeMetadata(retry.metadata, {
        cancelledBy: authResult.auth.identity.subject,
        cancelledAt
      });

      await updateEventIngressRetry(eventId, {
        retryState: 'cancelled',
        metadata
      });

      await removeEventRetryJob(eventId, retry.attempts ?? 1);

      await authResult.auth.log('succeeded', {
        action: 'retries.events.cancel',
        eventId,
        attempts: retry.attempts
      });

      await emitApphubEvent({
        type: 'retry.event.source.cancelled',
        data: {
          eventId,
          source: retry.source,
          attempts: retry.attempts,
          cancelledAt,
          cancelledBy: authResult.auth.identity.subject
        }
      });

      reply.status(200);
      return {
        data: {
          eventId,
          retryState: 'cancelled'
        }
      };
    } catch (err) {
      request.log.error({ err, eventId }, 'Failed to cancel event retry');
      reply.status(500);
      await authResult.auth.log('failed', {
        reason: 'event_retry_cancel_failure',
        eventId,
        error: err instanceof Error ? err.message : String(err)
      });
      return { error: 'Failed to cancel event retry' };
    }
  });

  app.post<{ Params: { eventId: string } }>('/admin/retries/events/:eventId/force', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'retries.events.force',
      resource: 'workflows',
      requiredScopes: WORKFLOW_RUN_SCOPES
    });

    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const eventId = request.params.eventId?.trim();
    if (!eventId) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'missing_event_id' });
      return { error: 'eventId is required' };
    }

    try {
      const retry = await getEventIngressRetryById(eventId);
      if (!retry || retry.retryState !== 'scheduled') {
        reply.status(404);
        await authResult.auth.log('failed', {
          reason: 'event_retry_not_found',
          eventId
        });
        return { error: 'event retry not found' };
      }

      const nowIso = new Date().toISOString();
      const metadata = mergeMetadata(retry.metadata, {
        forcedBy: authResult.auth.identity.subject,
        forcedAt: nowIso
      });

      await updateEventIngressRetry(eventId, {
        retryState: 'pending',
        nextAttemptAt: nowIso,
        metadata
      });

      await removeEventRetryJob(eventId, retry.attempts ?? 1);
      await scheduleEventRetryJob(eventId, nowIso, Math.max(retry.attempts ?? 1, 1));

      const eventRecord = await getWorkflowEventById(eventId);

      await authResult.auth.log('succeeded', {
        action: 'retries.events.force',
        eventId,
        attempts: retry.attempts
      });

      await emitApphubEvent({
        type: 'retry.event.source.forced',
        data: {
          eventId,
          source: retry.source,
          attempts: retry.attempts,
          scheduledAt: nowIso,
          forcedBy: authResult.auth.identity.subject,
          eventType: eventRecord?.type ?? null
        }
      });

      reply.status(202);
      return {
        data: {
          eventId,
          retryState: 'pending',
          scheduledAt: nowIso
        }
      };
    } catch (err) {
      request.log.error({ err, eventId }, 'Failed to force-run event retry');
      reply.status(500);
      await authResult.auth.log('failed', {
        reason: 'event_retry_force_failure',
        eventId,
        error: err instanceof Error ? err.message : String(err)
      });
      return { error: 'Failed to force-run event retry' };
    }
  });

  app.post<{ Params: { deliveryId: string } }>(
    '/admin/retries/deliveries/:deliveryId/cancel',
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'retries.deliveries.cancel',
        resource: 'workflows',
        requiredScopes: WORKFLOW_RUN_SCOPES
      });

      if (!authResult.ok) {
        return { error: authResult.error };
      }

      const deliveryId = request.params.deliveryId?.trim();
      if (!deliveryId) {
        reply.status(400);
        await authResult.auth.log('failed', { reason: 'missing_delivery_id' });
        return { error: 'deliveryId is required' };
      }

      try {
        const delivery = await getWorkflowTriggerDeliveryById(deliveryId);
        if (!delivery || delivery.retryState !== 'scheduled') {
          reply.status(404);
          await authResult.auth.log('failed', {
            reason: 'delivery_retry_not_found',
            deliveryId
          });
          return { error: 'trigger delivery retry not found' };
        }

        const cancelledAt = new Date().toISOString();
        const metadata = mergeMetadata(delivery.retryMetadata, {
          cancelledBy: authResult.auth.identity.subject,
          cancelledAt
        });

        await updateWorkflowTriggerDelivery(deliveryId, {
          retryState: 'cancelled',
          nextAttemptAt: null,
          retryMetadata: metadata
        });

        await removeEventTriggerRetryJob(deliveryId, delivery.retryAttempts ?? 1);

        await authResult.auth.log('succeeded', {
          action: 'retries.deliveries.cancel',
          deliveryId,
          triggerId: delivery.triggerId,
          attempts: delivery.retryAttempts
        });

        await emitApphubEvent({
          type: 'retry.trigger.delivery.cancelled',
          data: {
            deliveryId,
            triggerId: delivery.triggerId,
            workflowDefinitionId: delivery.workflowDefinitionId,
            attempts: delivery.retryAttempts,
            cancelledAt,
            cancelledBy: authResult.auth.identity.subject
          }
        });

        reply.status(200);
        return {
          data: {
            deliveryId,
            retryState: 'cancelled'
          }
        };
      } catch (err) {
        request.log.error({ err, deliveryId }, 'Failed to cancel trigger delivery retry');
        reply.status(500);
        await authResult.auth.log('failed', {
          reason: 'delivery_retry_cancel_failure',
          deliveryId,
          error: err instanceof Error ? err.message : String(err)
        });
        return { error: 'Failed to cancel trigger delivery retry' };
      }
    }
  );

  app.post<{ Params: { deliveryId: string } }>(
    '/admin/retries/deliveries/:deliveryId/force',
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'retries.deliveries.force',
        resource: 'workflows',
        requiredScopes: WORKFLOW_RUN_SCOPES
      });

      if (!authResult.ok) {
        return { error: authResult.error };
      }

      const deliveryId = request.params.deliveryId?.trim();
      if (!deliveryId) {
        reply.status(400);
        await authResult.auth.log('failed', { reason: 'missing_delivery_id' });
        return { error: 'deliveryId is required' };
      }

      try {
        const delivery = await getWorkflowTriggerDeliveryById(deliveryId);
        if (!delivery || delivery.retryState !== 'scheduled') {
          reply.status(404);
          await authResult.auth.log('failed', {
            reason: 'delivery_retry_not_found',
            deliveryId
          });
          return { error: 'trigger delivery retry not found' };
        }

        const forcedAt = new Date().toISOString();
        const metadata = mergeMetadata(delivery.retryMetadata, {
          forcedBy: authResult.auth.identity.subject,
          forcedAt
        });
        const scheduledAt = forcedAt;

        await updateWorkflowTriggerDelivery(deliveryId, {
          retryState: 'pending',
          nextAttemptAt: scheduledAt,
          retryMetadata: metadata
        });

        await removeEventTriggerRetryJob(deliveryId, delivery.retryAttempts ?? 1);
        await scheduleEventTriggerRetryJob(
          deliveryId,
          delivery.eventId,
          scheduledAt,
          Math.max(delivery.retryAttempts ?? 1, 1)
        );

        await authResult.auth.log('succeeded', {
          action: 'retries.deliveries.force',
          deliveryId,
          triggerId: delivery.triggerId,
          attempts: delivery.retryAttempts
        });

        await emitApphubEvent({
          type: 'retry.trigger.delivery.forced',
          data: {
            deliveryId,
            triggerId: delivery.triggerId,
            workflowDefinitionId: delivery.workflowDefinitionId,
            attempts: delivery.retryAttempts,
            forcedAt,
            scheduledAt,
            forcedBy: authResult.auth.identity.subject
          }
        });

        reply.status(202);
        return {
          data: {
            deliveryId,
            retryState: 'pending'
          }
        };
      } catch (err) {
        request.log.error({ err, deliveryId }, 'Failed to force-run trigger delivery retry');
        reply.status(500);
        await authResult.auth.log('failed', {
          reason: 'delivery_retry_force_failure',
          deliveryId,
          error: err instanceof Error ? err.message : String(err)
        });
        return { error: 'Failed to force-run trigger delivery retry' };
      }
    }
  );

  app.post<{ Params: { stepId: string } }>(
    '/admin/retries/workflow-steps/:stepId/cancel',
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'retries.workflow_steps.cancel',
        resource: 'workflows',
        requiredScopes: WORKFLOW_RUN_SCOPES
      });

      if (!authResult.ok) {
        return { error: authResult.error };
      }

      const stepId = request.params.stepId?.trim();
      if (!stepId) {
        reply.status(400);
        await authResult.auth.log('failed', { reason: 'missing_step_id' });
        return { error: 'stepId is required' };
      }

      try {
        const step = await getWorkflowRunStepById(stepId);
        if (!step || step.retryState !== 'scheduled') {
          reply.status(404);
          await authResult.auth.log('failed', {
            reason: 'workflow_step_retry_not_found',
            stepId
          });
          return { error: 'workflow step retry not found' };
        }

        const cancelledAt = new Date().toISOString();
        const metadata = mergeMetadata(step.retryMetadata ?? null, {
          cancelledBy: authResult.auth.identity.subject,
          cancelledAt
        });

        await updateWorkflowRunStep(stepId, {
          retryState: 'cancelled',
          nextAttemptAt: null,
          retryMetadata: metadata
        });

        await removeWorkflowRetryJob(step.workflowRunId, step.stepId ?? null, step.retryAttempts ?? 1);

        await authResult.auth.log('succeeded', {
          action: 'retries.workflow_steps.cancel',
          workflowRunId: step.workflowRunId,
          workflowRunStepId: stepId,
          stepId: step.stepId,
          attempts: step.retryAttempts
        });

        await emitApphubEvent({
          type: 'retry.workflow.step.cancelled',
          data: {
            workflowRunId: step.workflowRunId,
            workflowRunStepId: stepId,
            stepId: step.stepId,
            attempts: step.retryAttempts,
            cancelledAt,
            cancelledBy: authResult.auth.identity.subject
          }
        });

        reply.status(200);
        return {
          data: {
            workflowRunStepId: stepId,
            retryState: 'cancelled'
          }
        };
      } catch (err) {
        request.log.error({ err, stepId }, 'Failed to cancel workflow step retry');
        reply.status(500);
        await authResult.auth.log('failed', {
          reason: 'workflow_step_retry_cancel_failure',
          workflowRunStepId: stepId,
          error: err instanceof Error ? err.message : String(err)
        });
        return { error: 'Failed to cancel workflow step retry' };
      }
    }
  );

  app.post<{ Params: { stepId: string } }>(
    '/admin/retries/workflow-steps/:stepId/force',
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'retries.workflow_steps.force',
        resource: 'workflows',
        requiredScopes: WORKFLOW_RUN_SCOPES
      });

      if (!authResult.ok) {
        return { error: authResult.error };
      }

      const stepId = request.params.stepId?.trim();
      if (!stepId) {
        reply.status(400);
        await authResult.auth.log('failed', { reason: 'missing_step_id' });
        return { error: 'stepId is required' };
      }

      try {
        const step = await getWorkflowRunStepById(stepId);
        if (!step || step.retryState !== 'scheduled') {
          reply.status(404);
          await authResult.auth.log('failed', {
            reason: 'workflow_step_retry_not_found',
            stepId
          });
          return { error: 'workflow step retry not found' };
        }

        const forcedAt = new Date().toISOString();
        const metadata = mergeMetadata(step.retryMetadata ?? null, {
          forcedBy: authResult.auth.identity.subject,
          forcedAt
        });
        const scheduledAt = forcedAt;

        await updateWorkflowRunStep(stepId, {
          retryState: 'pending',
          nextAttemptAt: scheduledAt,
          retryMetadata: metadata
        });

        await removeWorkflowRetryJob(step.workflowRunId, step.stepId ?? null, step.retryAttempts ?? 1);
        await scheduleWorkflowRetryJob(
          step.workflowRunId,
          step.stepId ?? null,
          scheduledAt,
          Math.max(step.retryAttempts ?? 1, 1)
        );

        await authResult.auth.log('succeeded', {
          action: 'retries.workflow_steps.force',
          workflowRunId: step.workflowRunId,
          workflowRunStepId: stepId,
          stepId: step.stepId,
          attempts: step.retryAttempts
        });

        await emitApphubEvent({
          type: 'retry.workflow.step.forced',
          data: {
            workflowRunId: step.workflowRunId,
            workflowRunStepId: stepId,
            stepId: step.stepId,
            attempts: step.retryAttempts,
            forcedAt,
            scheduledAt,
            forcedBy: authResult.auth.identity.subject
          }
        });

        reply.status(202);
        return {
          data: {
            workflowRunStepId: stepId,
            retryState: 'pending'
          }
        };
      } catch (err) {
        request.log.error({ err, stepId }, 'Failed to force-run workflow step retry');
        reply.status(500);
        await authResult.auth.log('failed', {
          reason: 'workflow_step_retry_force_failure',
          workflowRunStepId: stepId,
          error: err instanceof Error ? err.message : String(err)
        });
        return { error: 'Failed to force-run workflow step retry' };
      }
    }
  );

  app.get('/admin/events', async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;

    const type = typeof query.type === 'string' ? query.type.trim() : undefined;
    const source = typeof query.source === 'string' ? query.source.trim() : undefined;
    const correlationId =
      typeof query.correlationId === 'string' ? query.correlationId.trim() : undefined;
    const jsonPath = typeof query.jsonPath === 'string' ? query.jsonPath.trim() : undefined;
    const cursorParam = typeof query.cursor === 'string' ? query.cursor.trim() : undefined;

    let cursor = null;
    if (cursorParam && cursorParam.length > 0) {
      cursor = decodeWorkflowEventCursor(cursorParam);
      if (!cursor) {
        reply.status(400);
        return { error: 'Invalid cursor' };
      }
    }

    const parseTimestamp = (value: unknown, field: string): string | undefined => {
      if (value === undefined || value === null) {
        return undefined;
      }
      if (typeof value !== 'string') {
        throw new Error(`${field} must be a string ISO-8601 timestamp`);
      }
      const trimmed = value.trim();
      if (!trimmed) {
        return undefined;
      }
      const parsed = new Date(trimmed);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`${field} must be a valid ISO-8601 timestamp`);
      }
      return parsed.toISOString();
    };

    let from: string | undefined;
    let to: string | undefined;

    try {
      from = parseTimestamp(query.from, 'from');
      to = parseTimestamp(query.to, 'to');
    } catch (err) {
      reply.status(400);
      return { error: (err as Error).message };
    }

    let limit: number | undefined;
    if (query.limit !== undefined) {
      const value = typeof query.limit === 'number' ? query.limit : Number.parseInt(String(query.limit), 10);
      if (!Number.isFinite(value)) {
        reply.status(400);
        return { error: 'limit must be a positive integer' };
      }
      limit = value;
    }

    try {
      const result = await listWorkflowEvents({
        type: type && type.length > 0 ? type : undefined,
        source: source && source.length > 0 ? source : undefined,
        correlationId: correlationId && correlationId.length > 0 ? correlationId : undefined,
        from,
        to,
        limit,
        jsonPath: jsonPath && jsonPath.length > 0 ? jsonPath : undefined,
        cursor: cursor ?? undefined
      });

      const schema = buildWorkflowEventSchema(result.events);
      const serialized = result.events.map((event) => buildWorkflowEventView(event));
      const nextCursor = result.nextCursor ? encodeWorkflowEventCursor(result.nextCursor) : null;

      reply.status(200);
      return {
        data: {
          events: serialized,
          page: {
            nextCursor,
            hasMore: result.hasMore,
            limit: result.limit
          }
        },
        schema
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = typeof (err as { code?: unknown }).code === 'string' ? (err as { code: string }).code : null;
      const isJsonPathError =
        code === '22023' || message.toLowerCase().includes('jsonpath') || message.toLowerCase().includes('json path');
      if (isJsonPathError) {
        reply.status(400);
        return { error: 'Invalid jsonPath filter expression' };
      }
      request.log.error({ err }, 'Failed to list workflow events');
      reply.status(500);
      return { error: 'Failed to list workflow events' };
    }
  });

  app.post('/admin/catalog/nuke/run-data', async (request, reply) => {
    try {
      const counts = await nukeCatalogRunData();
      request.log.warn(
        {
          buildsDeleted: counts.builds ?? 0,
          launchesDeleted: counts.launches ?? 0,
          serviceNetworkLaunchMembersDeleted: counts.service_network_launch_members ?? 0,
          serviceNetworkMembersDeleted: counts.service_network_members ?? 0,
          serviceNetworksDeleted: counts.service_networks ?? 0
        },
        'Catalog run data nuked'
      );
      reply.status(200);
      return {
        data: {
          builds: counts.builds ?? 0,
          launches: counts.launches ?? 0,
          counts
        }
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to nuke catalog run data');
      reply.status(500);
      return { error: 'Failed to nuke catalog run data' };
    }
  });

  app.post('/admin/catalog/nuke', async (request, reply) => {
    try {
      const counts = await nukeCatalogDatabase();
      resetServiceManifestState();

      request.log.warn(
        {
          repositoriesDeleted: counts.repositories ?? 0,
          buildsDeleted: counts.builds ?? 0,
          launchesDeleted: counts.launches ?? 0,
          tagsDeleted: counts.tags ?? 0,
          serviceNetworkLaunchMembersDeleted: counts.service_network_launch_members ?? 0,
          serviceNetworkMembersDeleted: counts.service_network_members ?? 0,
          serviceNetworksDeleted: counts.service_networks ?? 0,
          repositoryPreviewsDeleted: counts.repository_previews ?? 0,
          repositoryTagsDeleted: counts.repository_tags ?? 0,
          ingestionEventsDeleted: counts.ingestion_events ?? 0,
          repositorySearchEntriesDeleted: counts.repository_search ?? 0,
          servicesDeleted: counts.services ?? 0
        },
        'Catalog database nuked'
      );
      reply.status(200);
      return {
        data: {
          repositories: counts.repositories ?? 0,
          builds: counts.builds ?? 0,
          launches: counts.launches ?? 0,
          tags: counts.tags ?? 0,
          counts
        }
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to nuke catalog database');
      reply.status(500);
      return { error: 'Failed to nuke catalog database' };
    }
  });

  app.post('/admin/catalog/nuke/everything', async (request, reply) => {
    try {
      const counts = await nukeCatalogEverything();
      resetServiceManifestState();

      markDatabaseUninitialized();
      await ensureDatabase();

      const totalRowsDeleted = Object.values(counts).reduce((acc, value) => acc + value, 0);

      request.log.warn(
        {
          tablesTruncated: Object.keys(counts).length,
          totalRowsDeleted,
          counts
        },
        'Entire catalog database nuked'
      );
      reply.status(200);
      return {
        data: {
          counts,
          totalRowsDeleted
        }
      };
    } catch (err) {
      request.log.error({ err }, 'Failed to nuke entire catalog database');
      reply.status(500);
      return { error: 'Failed to nuke entire catalog database' };
    }
  });
}
