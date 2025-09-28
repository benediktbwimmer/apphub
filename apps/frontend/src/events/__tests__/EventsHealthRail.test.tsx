import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { WorkflowEventSchedulerHealth } from '../../workflows/types';
import EventsHealthRail from '../EventsHealthRail';

const sampleHealth: WorkflowEventSchedulerHealth = {
  generatedAt: '2025-01-02T00:00:00.000Z',
  queues: {
    ingress: { mode: 'queue', counts: { pending: 4 } },
    triggers: { mode: 'queue', counts: { pending: 2 } }
  },
  sources: {
    'metastore.api': {
      total: 120,
      throttled: 4,
      dropped: 1,
      failures: 2,
      averageLagMs: 450,
      lastLagMs: 300,
      maxLagMs: 1200,
      lastEventAt: '2025-01-02T00:00:00.000Z'
    }
  },
  triggers: {},
  pausedTriggers: {
    'trigger-1': {
      reason: 'error burst',
      until: '2025-01-02T01:00:00.000Z'
    }
  },
  pausedSources: [
    {
      source: 'filestore.sync',
      reason: 'maintenance',
      until: '2025-01-02T02:00:00.000Z'
    }
  ],
  rateLimits: [],
  retries: {
    events: {
      summary: {
        total: 5,
        overdue: 2,
        nextAttemptAt: '2025-01-02T00:10:00.000Z'
      },
      entries: [
        {
          eventId: 'evt-1',
          source: 'metastore.api',
          eventType: 'metastore.record.updated',
          eventSource: 'metastore.api',
          attempts: 2,
          nextAttemptAt: '2025-01-02T00:05:00.000Z',
          overdue: true,
          retryState: 'pending',
          lastError: 'timeout',
          metadata: null,
          createdAt: '2025-01-01T23:00:00.000Z',
          updatedAt: '2025-01-01T23:05:00.000Z'
        }
      ]
    },
    triggers: {
      summary: {
        total: 3,
        overdue: 1,
        nextAttemptAt: '2025-01-02T00:12:00.000Z'
      },
      entries: [
        {
          deliveryId: 'del-1',
          triggerId: 'trigger-1',
          workflowDefinitionId: 'wf-1',
          workflowSlug: 'asset-sync',
          triggerName: 'Asset sync',
          eventType: 'asset.produced',
          eventSource: 'workflows.events',
          attempts: 1,
          retryAttempts: 1,
          nextAttemptAt: '2025-01-02T00:07:00.000Z',
          overdue: false,
          retryState: 'pending',
          lastError: null,
          workflowRunId: null,
          dedupeKey: null,
          createdAt: '2025-01-01T22:00:00.000Z',
          updatedAt: '2025-01-01T22:05:00.000Z'
        }
      ]
    },
    workflowSteps: {
      summary: {
        total: 2,
        overdue: 0,
        nextAttemptAt: '2025-01-02T00:15:00.000Z'
      },
      entries: [
        {
          workflowRunStepId: 'step-1',
          workflowRunId: 'run-1',
          workflowDefinitionId: 'wf-1',
          workflowSlug: 'asset-sync',
          stepId: 'materialize',
          status: 'pending',
          attempt: 2,
          retryAttempts: 1,
          nextAttemptAt: '2025-01-02T00:15:00.000Z',
          overdue: false,
          retryState: 'pending',
          retryCount: 1,
          retryMetadata: null,
          errorMessage: null,
          updatedAt: '2025-01-01T22:10:00.000Z'
        }
      ]
    }
  }
};

describe('EventsHealthRail', () => {
  it('renders source metrics and backlog summaries', async () => {
    render(
      <EventsHealthRail
        health={sampleHealth}
        loading={false}
        refreshing={false}
        error={null}
        lastUpdatedAt="2025-01-02T00:00:30.000Z"
        onRefresh={async () => {}}
      />
    );

    expect(screen.getByText('Scheduler health')).toBeInTheDocument();
    expect(screen.getAllByText(/metastore\.api/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Total 120/)).toBeInTheDocument();
    expect(screen.getAllByText(/Retry backlog/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Ingress events/i)).toBeInTheDocument();
    expect(screen.getByText(/Sources paused/i)).toBeInTheDocument();
  });

  it('can collapse and expand', async () => {
    render(
      <EventsHealthRail
        health={sampleHealth}
        loading={false}
        refreshing={false}
        error={null}
        lastUpdatedAt={null}
        onRefresh={async () => {}}
      />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(screen.queryAllByText(/Retry backlog/i)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getAllByText(/Retry backlog/i).length).toBeGreaterThan(0);
  });
});
