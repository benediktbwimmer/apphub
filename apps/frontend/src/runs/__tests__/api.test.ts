import { describe, expect, it, vi } from 'vitest';

import {
  fetchWorkflowRunDiff,
  replayWorkflowRun,
  WorkflowRunReplayBlockedError
} from '../api';
import type { AuthorizedFetch } from '../../lib/apiClient';

const ISO = '2024-01-01T00:00:00.000Z';

function createRunPayload(id: string) {
  return {
    id,
    workflowDefinitionId: 'wf-alpha',
    status: 'succeeded',
    runKey: null,
    health: 'healthy',
    currentStepId: null,
    currentStepIndex: null,
    startedAt: ISO,
    completedAt: ISO,
    durationMs: 1000,
    errorMessage: null,
    triggeredBy: 'ops',
    partitionKey: null,
    metrics: null,
    parameters: { foo: 'bar' },
    context: { step: 'extract' },
    output: { ok: true },
    trigger: null,
    createdAt: ISO,
    updatedAt: ISO,
    retrySummary: {
      pendingSteps: 0,
      overdueSteps: 0,
      nextAttemptAt: null
    }
  } satisfies Record<string, unknown>;
}

describe('runs api', () => {
  it('normalizes workflow run diff payloads', async () => {
    const responseBody = {
      data: {
        base: {
          run: createRunPayload('run-base'),
          history: [
            {
              id: 'hist-1',
              workflowRunId: 'run-base',
              workflowRunStepId: null,
              stepId: null,
              eventType: 'run.start',
              eventPayload: { status: 'running' },
              createdAt: ISO
            }
          ],
          assets: [
            {
              id: 'asset-1',
              workflowDefinitionId: 'wf-alpha',
              workflowRunId: 'run-base',
              workflowRunStepId: 'step-1',
              stepId: 'extract',
              assetId: 'dataset.users',
              partitionKey: null,
              producedAt: ISO,
              payload: { version: 1 },
              freshness: null,
              schema: null,
              createdAt: ISO,
              updatedAt: ISO
            }
          ]
        },
        compare: {
          run: createRunPayload('run-compare'),
          history: [
            {
              id: 'hist-2',
              workflowRunId: 'run-compare',
              workflowRunStepId: null,
              stepId: null,
              eventType: 'run.start',
              eventPayload: { status: 'running' },
              createdAt: ISO
            }
          ],
          assets: []
        },
        diff: {
          parameters: [
            {
              path: 'foo',
              change: 'changed',
              before: 'bar',
              after: 'baz'
            }
          ],
          context: [],
          output: [],
          statusTransitions: [
            {
              index: 0,
              change: 'identical',
              base: {
                id: 'hist-1',
                workflowRunId: 'run-base',
                workflowRunStepId: null,
                stepId: null,
                eventType: 'run.start',
                eventPayload: { status: 'running' },
                createdAt: ISO
              },
              compare: {
                id: 'hist-2',
                workflowRunId: 'run-compare',
                workflowRunStepId: null,
                stepId: null,
                eventType: 'run.start',
                eventPayload: { status: 'running' },
                createdAt: ISO
              }
            }
          ],
          assets: []
        },
        staleAssets: []
      }
    } satisfies Record<string, unknown>;

    const fetcher: AuthorizedFetch = vi.fn(async () => {
      return new Response(JSON.stringify(responseBody), { status: 200 });
    });

    const diff = await fetchWorkflowRunDiff(fetcher, {
      runId: 'run-base',
      compareTo: 'run-compare'
    });

    expect(diff.base.run.id).toBe('run-base');
    expect(diff.compare.run.id).toBe('run-compare');
    expect(diff.diff.parameters).toHaveLength(1);
    expect(diff.diff.parameters[0]?.path).toBe('foo');
    expect(diff.diff.statusTransitions[0]?.change).toBe('identical');
    expect(diff.staleAssets).toHaveLength(0);
  });

  it('throws replay blocked error when stale assets are detected', async () => {
    const fetcher: AuthorizedFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: 'stale assets detected',
          data: {
            staleAssets: [
              {
                assetId: 'dataset.users',
                partitionKey: '2024-01-01',
                stepId: 'extract',
                requestedAt: ISO,
                requestedBy: 'ops@example.com',
                note: 'Manual refresh pending'
              }
            ]
          }
        }),
        { status: 409 }
      );
    });

    await expect(replayWorkflowRun(fetcher, 'run-base')).rejects.toBeInstanceOf(WorkflowRunReplayBlockedError);

    try {
      await replayWorkflowRun(fetcher, 'run-base');
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowRunReplayBlockedError);
      const blocked = err as WorkflowRunReplayBlockedError;
      expect(blocked.staleAssets).toHaveLength(1);
      expect(blocked.staleAssets[0]?.assetId).toBe('dataset.users');
    }
  });
});
