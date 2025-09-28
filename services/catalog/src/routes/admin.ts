import type { FastifyInstance } from 'fastify';
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
import { WORKFLOW_RUN_SCOPES } from './shared/scopes';
import { getWorkflowSchedulerMetricsSnapshot } from '../workflowSchedulerMetrics';

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
