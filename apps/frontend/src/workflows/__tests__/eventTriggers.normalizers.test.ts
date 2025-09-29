import { describe, expect, it } from 'vitest';
import {
  normalizeWorkflowEventHealth,
  normalizeWorkflowEventSamples,
  normalizeWorkflowEventTrigger
} from '../normalizers';

describe('event trigger normalizers', () => {
  it('normalizes event trigger records with numeric coercion', () => {
    const raw = {
      id: 'trigger-1',
      workflowDefinitionId: 'wf-1',
      version: 2,
      status: 'disabled',
      name: 'Directory updates',
      description: 'Watch for namespace changes',
      eventType: 'metastore.record.updated',
      eventSource: 'metastore.api',
      predicates: [
        { type: 'jsonPath', path: '$.payload.namespace', operator: 'equals', value: 'hr' },
        { type: 'jsonPath', path: '$.payload.status', operator: 'in', values: ['active', 'pending'] },
        { type: 'jsonPath', path: '$.payload.version', operator: 'gte', value: 2 },
        { type: 'jsonPath', path: '$.payload.version', operator: 'lt', value: 10 },
        {
          type: 'jsonPath',
          path: '$.payload.slug',
          operator: 'regex',
          value: '^hr-[0-9]+$',
          flags: 'im'
        },
        {
          type: 'jsonPath',
          path: '$.payload.description',
          operator: 'contains',
          value: 'critical',
          caseSensitive: false
        }
      ],
      parameterTemplate: { namespace: '{{ event.payload.namespace }}' },
      runKeyTemplate: '{{ parameters.namespace }}-{{ event.id }}',
      throttleWindowMs: '60000',
      throttleCount: '10',
      maxConcurrency: '4',
      idempotencyKeyExpression: '{{ event.metadata.upsertId }}',
      metadata: { owner: 'workflow-team' },
      createdAt: '2024-03-10T00:00:00.000Z',
      updatedAt: '2024-03-11T00:00:00.000Z',
      createdBy: 'ops@apphub.test',
      updatedBy: 'ops@apphub.test'
    };

    const normalized = normalizeWorkflowEventTrigger(raw);
    expect(normalized).toBeTruthy();
    expect(normalized?.status).toBe('disabled');
    expect(normalized?.throttleWindowMs).toBe(60000);
    expect(normalized?.throttleCount).toBe(10);
    expect(normalized?.maxConcurrency).toBe(4);
    expect(normalized?.predicates).toHaveLength(6);
    expect(normalized?.predicates[0]).toMatchObject({ path: '$.payload.namespace', operator: 'equals' });
    expect(normalized?.predicates[1]).toMatchObject({ operator: 'in', values: ['active', 'pending'] });
    expect(normalized?.predicates[2]).toMatchObject({ operator: 'gte', value: 2 });
    expect(normalized?.predicates[3]).toMatchObject({ operator: 'lt', value: 10 });
    expect(normalized?.predicates[4]).toMatchObject({ operator: 'regex', value: '^hr-[0-9]+$', flags: 'im' });
    expect(normalized?.predicates[5]).toMatchObject({ operator: 'contains', value: 'critical' });
    expect(normalized?.parameterTemplate).toEqual({ namespace: '{{ event.payload.namespace }}' });
    expect(normalized?.runKeyTemplate).toBe('{{ parameters.namespace }}-{{ event.id }}');
  });

  it('normalizes event samples list and skips invalid entries', () => {
    const samples = normalizeWorkflowEventSamples([
      {
        id: 'evt-1',
        type: 'metastore.record.updated',
        source: 'metastore.api',
        occurredAt: '2024-03-11T10:00:00.000Z',
        receivedAt: '2024-03-11T10:00:01.000Z',
        payload: { namespace: 'hr', key: 'employees' },
        correlationId: 'corr-1',
        ttlMs: '300000',
        metadata: { actor: 'service' }
      },
      null,
      {
        id: 'evt-2',
        type: 'filestore.command.completed',
        source: 'filestore.worker',
        occurredAt: '2024-03-11T10:05:00.000Z',
        receivedAt: '2024-03-11T10:05:01.000Z',
        payload: { command: 'upload' },
        ttlMs: null
      }
    ]);

    expect(samples).toHaveLength(2);
    expect(samples[0].type).toBe('metastore.record.updated');
    expect(samples[0].ttlMs).toBe(300000);
    expect(samples[1].type).toBe('filestore.command.completed');
    expect(samples[1].ttlMs).toBeNull();
  });

  it('normalizes event health snapshots with metrics and pause state', () => {
    const raw = {
      data: {
        queues: {
          ingress: { mode: 'queue', counts: { pending: 3 } },
          triggers: { mode: 'inline', counts: { pending: 1 } }
        },
        metrics: {
          generatedAt: '2024-03-11T10:30:00.000Z',
          triggers: [
            {
              triggerId: 'trigger-1',
              counts: { matched: 5, launched: 2, throttled: 1, failed: 0, filtered: 7 },
              lastStatus: 'matched',
              lastUpdatedAt: '2024-03-11T10:29:00.000Z',
              lastError: null
            }
          ],
          sources: [
            {
              source: 'metastore.api',
              total: 20,
              throttled: 1,
              dropped: 0,
              failures: 0,
              averageLagMs: 120,
              lastLagMs: 30,
              maxLagMs: 250,
              lastEventAt: '2024-03-11T10:29:30.000Z'
            }
          ]
        },
        pausedTriggers: [{ triggerId: 'trigger-1', reason: 'maintenance', until: '2024-03-11T12:00:00.000Z' }],
        pausedSources: [
          {
            source: 'metastore.api',
            reason: 'rate-limit',
            until: '2024-03-11T11:00:00.000Z',
            details: { initiatedBy: 'oncall' }
          }
        ],
        rateLimits: [{ source: 'metastore.api', limit: 100, intervalMs: 60000, pauseMs: 120000 }],
        retries: {
          events: {
            summary: { total: 2, overdue: 1, nextAttemptAt: '2024-03-11T10:35:00.000Z' },
            entries: [
              {
                eventId: 'evt-1',
                source: 'metastore.api',
                eventType: 'metastore.record.updated',
                eventSource: 'metastore.api',
                attempts: 1,
                nextAttemptAt: '2024-03-11T10:35:00.000Z',
                overdue: true,
                retryState: 'scheduled',
                lastError: 'throttled',
                metadata: { reason: 'paused' },
                createdAt: '2024-03-11T10:30:00.000Z',
                updatedAt: '2024-03-11T10:31:00.000Z'
              }
            ]
          },
          triggers: {
            summary: { total: 1, overdue: 0, nextAttemptAt: '2024-03-11T10:40:00.000Z' },
            entries: [
              {
                deliveryId: 'delivery-1',
                triggerId: 'trigger-1',
                workflowDefinitionId: 'wf-1',
                workflowSlug: 'wf-slug',
                triggerName: 'Directory updates',
                eventType: 'metastore.record.updated',
                eventSource: 'metastore.api',
                attempts: 1,
                retryAttempts: 2,
                nextAttemptAt: '2024-03-11T10:40:00.000Z',
                overdue: false,
                retryState: 'scheduled',
                lastError: null,
                workflowRunId: null,
                dedupeKey: null,
                createdAt: '2024-03-11T10:30:00.000Z',
                updatedAt: '2024-03-11T10:32:00.000Z'
              }
            ]
          },
          workflowSteps: {
            summary: { total: 1, overdue: 0, nextAttemptAt: '2024-03-11T10:45:00.000Z' },
            entries: [
              {
                workflowRunStepId: 'run-step-1',
                workflowRunId: 'run-1',
                workflowDefinitionId: 'wf-1',
                workflowSlug: 'wf-slug',
                stepId: 'step-1',
                status: 'pending',
                attempt: 1,
                retryAttempts: 1,
                nextAttemptAt: '2024-03-11T10:45:00.000Z',
                overdue: false,
                retryState: 'scheduled',
                retryCount: 1,
                retryMetadata: null,
                errorMessage: null,
                updatedAt: '2024-03-11T10:32:30.000Z'
              }
            ]
          }
        }
      }
    };

    const health = normalizeWorkflowEventHealth(raw);
    expect(health).toBeTruthy();
    expect(health?.queues.ingress.mode).toBe('queue');
    expect(health?.queues.ingress.counts?.pending).toBe(3);
    expect(health?.queues.triggers.mode).toBe('inline');
    expect(health?.triggers['trigger-1']?.counts.matched).toBe(5);
    expect(health?.triggers['trigger-1']?.lastStatus).toBe('matched');
    expect(health?.sources['metastore.api']?.total).toBe(20);
    expect(health?.pausedTriggers['trigger-1']?.reason).toBe('maintenance');
    expect(health?.pausedSources[0]?.source).toBe('metastore.api');
    expect(health?.rateLimits[0]?.limit).toBe(100);
    expect(health?.retries.events.summary.total).toBe(2);
    expect(health?.retries.events.entries[0]?.eventId).toBe('evt-1');
    expect(health?.retries.triggers.entries[0]?.deliveryId).toBe('delivery-1');
    expect(health?.retries.workflowSteps.entries[0]?.stepId).toBe('step-1');
  });
});
