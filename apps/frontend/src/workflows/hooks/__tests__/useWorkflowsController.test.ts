import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  WorkflowAssetDetail,
  WorkflowAssetInventoryEntry,
  WorkflowAssetPartitions,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowRunStep
} from '../../types';
import type { AuthorizedFetch } from '../../api';
import {
  AppHubEventsContext,
  type AppHubEventHandler,
  type AppHubEventsClient
} from '../../../events/context';

const {
  workflowDefinition,
  runResponse,
  listWorkflowDefinitionsMock,
  getWorkflowDetailMock,
  listWorkflowRunStepsMock,
  listServicesMock,
  createWorkflowDefinitionMock,
  updateWorkflowDefinitionMock,
  fetchWorkflowAssetsMock,
  fetchWorkflowAssetHistoryMock,
  fetchWorkflowAssetPartitionsMock,
  fetchOperatorIdentityMock
} = vi.hoisted(() => {
  const definition = {
    id: 'wf-1',
    slug: 'demo-workflow',
    name: 'Demo Workflow',
    description: 'Test workflow for hook coverage',
    version: 1,
    steps: [
      { id: 'step-one', name: 'Step One', jobSlug: 'job-one', dependsOn: [], dependents: ['step-two'] },
      { id: 'step-two', name: 'Step Two', jobSlug: 'job-two', dependsOn: ['step-one'], dependents: [] }
    ],
    triggers: [{ type: 'manual' }],
    parametersSchema: { type: 'object' },
    defaultParameters: {},
    outputSchema: null,
    metadata: { repo: 'git@example.com/demo.git', tags: ['env:test'], status: 'succeeded' },
    dag: {
      roots: ['step-one'],
      adjacency: { 'step-one': ['step-two'], 'step-two': [] },
      topologicalOrder: ['step-one', 'step-two'],
      edges: 1
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as WorkflowDefinition;

  const run = {
    id: 'run-1',
    workflowDefinitionId: definition.id,
    status: 'pending',
    currentStepId: null,
    currentStepIndex: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    errorMessage: null,
    triggeredBy: 'operator@apphub.test',
    metrics: { totalSteps: 2, completedSteps: 0 },
    parameters: {},
    context: {},
    output: null,
    trigger: { type: 'manual' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  } as WorkflowRun;

  const steps = [
    {
      id: 'run-step-1',
      workflowRunId: run.id,
      stepId: 'step-one',
      status: 'running',
      attempt: 1,
      jobRunId: 'job-run-1',
      startedAt: new Date().toISOString(),
      completedAt: null,
      errorMessage: null,
      logsUrl: 'https://example.com/logs/1',
      metrics: { durationMs: 500 }
    }
  ] as WorkflowRunStep[];

  return {
    workflowDefinition: definition,
    runResponse: run,
    listWorkflowDefinitionsMock: vi.fn(async () => [definition]),
    getWorkflowDetailMock: vi.fn(async () => ({ workflow: definition, runs: [run] })),
    listWorkflowRunStepsMock: vi.fn(async () => ({ run, steps })),
    listServicesMock: vi.fn(async () => []),
    createWorkflowDefinitionMock: vi.fn(async () => definition),
    updateWorkflowDefinitionMock: vi.fn(async () => definition),
    fetchWorkflowAssetsMock: vi.fn(async () => [] as WorkflowAssetInventoryEntry[]),
    fetchWorkflowAssetHistoryMock: vi.fn<
      [AuthorizedFetch, string, string, { limit?: number }?],
      Promise<WorkflowAssetDetail | null>
    >(async () => ({
      assetId: 'inventory.dataset',
      producers: [],
      consumers: [],
      history: [],
      limit: 10
    }) as WorkflowAssetDetail),
    fetchWorkflowAssetPartitionsMock: vi.fn<
      [AuthorizedFetch, string, string, { lookback?: number }?],
      Promise<WorkflowAssetPartitions | null>
    >(async () => ({
      assetId: 'inventory.dataset',
      partitioning: null,
      partitions: []
    })),
    fetchOperatorIdentityMock: vi.fn(async () => ({
      scopes: ['workflows:write', 'jobs:write', 'job-bundles:write']
    }))
  };
});

let activeTokenMock: { id: string } | null = { id: 'token-1' };

const analyticsNow = new Date().toISOString();
const analyticsStats = {
  workflowId: workflowDefinition.id,
  slug: workflowDefinition.slug,
  range: { from: analyticsNow, to: analyticsNow, key: '7d' },
  totalRuns: 1,
  statusCounts: { succeeded: 1 },
  successRate: 1,
  failureRate: 0,
  averageDurationMs: 400,
  failureCategories: []
};
const analyticsMetrics = {
  workflowId: workflowDefinition.id,
  slug: workflowDefinition.slug,
  range: { from: analyticsNow, to: analyticsNow, key: '7d' },
  bucketInterval: '1 hour',
  bucket: { interval: '1 hour', key: 'hour' as const },
  series: [
    {
      bucketStart: analyticsNow,
      bucketEnd: analyticsNow,
      totalRuns: 1,
      statusCounts: { succeeded: 1 },
      averageDurationMs: 400,
      rollingSuccessCount: 1
    }
  ]
};

const authorizedFetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.toString();
  if (url.endsWith(`/workflows/${workflowDefinition.slug}/run`) && init?.method === 'POST') {
    return new Response(JSON.stringify({ data: runResponse }), { status: 202 });
  }
  if (url.includes(`/workflows/${workflowDefinition.slug}/stats`)) {
    return new Response(JSON.stringify({ data: analyticsStats }), { status: 200 });
  }
  if (url.includes(`/workflows/${workflowDefinition.slug}/run-metrics`)) {
    return new Response(JSON.stringify({ data: analyticsMetrics }), { status: 200 });
  }
  return new Response(JSON.stringify({ data: [] }), { status: 200 });
});

vi.mock('../../../auth/useAuthorizedFetch', () => ({
  useAuthorizedFetch: () => authorizedFetchMock
}));

vi.mock('../../../auth/useApiTokens', () => ({
  useApiTokens: () => ({ activeToken: activeTokenMock })
}));

const pushToastMock = vi.fn();

vi.mock('../../../components/toast', () => ({
  useToasts: () => ({ pushToast: pushToastMock })
}));

vi.mock('../../../components/JsonSyntaxHighlighter', () => ({
  __esModule: true,
  default: ({ value }: { value: unknown }) => JSON.stringify(value)
}));

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return {
    ...actual,
    listWorkflowDefinitions: listWorkflowDefinitionsMock,
    getWorkflowDetail: getWorkflowDetailMock,
    listWorkflowRunSteps: listWorkflowRunStepsMock,
    listServices: listServicesMock,
    createWorkflowDefinition: createWorkflowDefinitionMock,
    updateWorkflowDefinition: updateWorkflowDefinitionMock,
    fetchWorkflowAssets: fetchWorkflowAssetsMock,
    fetchWorkflowAssetHistory: fetchWorkflowAssetHistoryMock,
    fetchWorkflowAssetPartitions: fetchWorkflowAssetPartitionsMock,
    fetchOperatorIdentity: fetchOperatorIdentityMock
  };
});

import { useWorkflowsController } from '../useWorkflowsController';

let appHubClient: AppHubEventsClient;
let wrapper: ({ children }: { children: React.ReactNode }) => JSX.Element;

beforeEach(() => {
  activeTokenMock = { id: 'token-1' };
  authorizedFetchMock.mockClear();
  pushToastMock.mockClear();
  listWorkflowDefinitionsMock.mockClear();
  getWorkflowDetailMock.mockClear();
  listWorkflowRunStepsMock.mockClear();
  fetchWorkflowAssetsMock.mockClear();
  fetchWorkflowAssetHistoryMock.mockClear();
  fetchWorkflowAssetPartitionsMock.mockClear();
  const subscribers = new Set<AppHubEventHandler>();
  appHubClient = {
    subscribe: (handler) => {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    }
  };
  wrapper = ({ children }) =>
    createElement(AppHubEventsContext.Provider, { value: appHubClient }, children);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useWorkflowsController', () => {
  it('loads workflows and refreshes run data', async () => {
    const { result } = renderHook(() => useWorkflowsController(), { wrapper });

    await waitFor(() => expect(result.current.workflowsLoading).toBe(false));
    await waitFor(() => expect(listWorkflowDefinitionsMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.workflows).toHaveLength(1));
    await waitFor(() => expect(result.current.selectedSlug).toBe('demo-workflow'));
    expect(result.current.runs).toHaveLength(1);
    expect(listWorkflowDefinitionsMock).toHaveBeenCalled();
    expect(getWorkflowDetailMock).toHaveBeenCalledWith(expect.any(Function), 'demo-workflow');

    await act(async () => {
      await result.current.handleManualRun({ parameters: {} });
    });
    expect(result.current.manualRunError).toBeNull();
    expect(result.current.lastTriggeredRun?.id).toBe('run-1');
  });

  it('prevents manual runs when no active token is configured', async () => {
    activeTokenMock = null;

    const { result } = renderHook(() => useWorkflowsController(), { wrapper });

    await waitFor(() => expect(result.current.workflowsLoading).toBe(false));
    await waitFor(() => expect(listWorkflowDefinitionsMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.workflows).toHaveLength(1));
    await waitFor(() => expect(result.current.selectedSlug).toBe('demo-workflow'));

    await act(async () => {
      await result.current.handleManualRun({ parameters: {} });
    });

    expect(result.current.manualRunError).toContain('Add an operator token');
  });

  it('loads workflow assets when a workflow is selected', async () => {
    const producedAt = new Date().toISOString();
    const assetInventory: WorkflowAssetInventoryEntry[] = [
      {
        assetId: 'inventory.dataset',
        producers: [
          {
            stepId: 'asset-producer',
            stepName: 'Asset Producer',
            stepType: 'job',
            schema: null,
            freshness: null,
            autoMaterialize: null,
            partitioning: null
          }
        ],
        consumers: [
          {
            stepId: 'asset-consumer',
            stepName: 'Asset Consumer',
            stepType: 'job',
            schema: null,
            freshness: null,
            autoMaterialize: null,
            partitioning: null
          }
        ],
        latest: {
          runId: 'run-assets-1',
          runStatus: 'succeeded',
          stepId: 'asset-producer',
          stepName: 'Asset Producer',
          stepType: 'job',
          stepStatus: 'succeeded',
          producedAt,
          payload: { count: 7 },
          schema: { type: 'object' },
          freshness: { ttlMs: 3_600_000 },
          partitionKey: null,
          runStartedAt: producedAt,
          runCompletedAt: producedAt
        },
        available: true
      }
    ];
    fetchWorkflowAssetsMock.mockResolvedValue(assetInventory);

    const { result } = renderHook(() => useWorkflowsController(), { wrapper });

    await waitFor(() => expect(result.current.workflowsLoading).toBe(false));
    await waitFor(() => expect(result.current.selectedSlug).toBe('demo-workflow'));
    await waitFor(() => expect(result.current.assetInventoryLoading).toBe(false));

    expect(fetchWorkflowAssetsMock).toHaveBeenCalledWith(expect.any(Function), 'demo-workflow');
    expect(result.current.assetInventory).toEqual(assetInventory);
    expect(result.current.assetInventoryError).toBeNull();
  });

  it('selectAsset fetches history and caches detail', async () => {
    const producedAt = new Date().toISOString();
    const assetInventory: WorkflowAssetInventoryEntry[] = [
      {
        assetId: 'inventory.dataset',
        producers: [
          {
            stepId: 'asset-producer',
            stepName: 'Asset Producer',
            stepType: 'job',
            schema: null,
            freshness: null,
            autoMaterialize: null,
            partitioning: null
          }
        ],
        consumers: [
          {
            stepId: 'asset-consumer',
            stepName: 'Asset Consumer',
            stepType: 'job',
            schema: null,
            freshness: null,
            autoMaterialize: null,
            partitioning: null
          }
        ],
        latest: {
          runId: 'run-assets-1',
          runStatus: 'succeeded',
          stepId: 'asset-producer',
          stepName: 'Asset Producer',
          stepType: 'job',
          stepStatus: 'succeeded',
          producedAt,
          payload: { count: 7 },
          schema: { type: 'object' },
          freshness: { ttlMs: 3_600_000 },
          partitionKey: null,
          runStartedAt: producedAt,
          runCompletedAt: producedAt
        },
        available: true
      }
    ];
    fetchWorkflowAssetsMock.mockResolvedValue(assetInventory);

    const assetDetail: WorkflowAssetDetail = {
      assetId: 'inventory.dataset',
      producers: assetInventory[0]!.producers,
      consumers: assetInventory[0]!.consumers,
      history: [
        {
          runId: 'run-assets-1',
          runStatus: 'succeeded',
          stepId: 'asset-producer',
          stepName: 'Asset Producer',
          stepType: 'job',
          stepStatus: 'succeeded',
          producedAt,
          payload: { count: 7 },
          schema: { type: 'object' },
          freshness: { ttlMs: 3_600_000 },
          partitionKey: null,
          runStartedAt: producedAt,
          runCompletedAt: producedAt
        }
      ],
      limit: 10
    };
    fetchWorkflowAssetHistoryMock.mockResolvedValue(assetDetail);

    const partitions: WorkflowAssetPartitions = {
      assetId: 'inventory.dataset',
      partitioning: {
        type: 'timeWindow',
        granularity: 'day',
        timezone: 'UTC',
        format: 'yyyy-MM-dd',
        lookbackWindows: 7
      },
      partitions: [
        {
          partitionKey: '2025-09-23',
          materializations: 3,
          latest: {
            runId: 'run-assets-1',
            runStatus: 'succeeded',
            stepId: 'asset-producer',
            stepName: 'Asset Producer',
            stepType: 'job',
            stepStatus: 'succeeded',
            producedAt,
            payload: { count: 7 },
            schema: { type: 'object' },
            freshness: { ttlMs: 3_600_000 },
            partitionKey: '2025-09-23',
            runStartedAt: producedAt,
            runCompletedAt: producedAt
          },
          isStale: false,
          staleMetadata: null,
          parameters: null,
          parametersSource: null,
          parametersCapturedAt: null,
          parametersUpdatedAt: null
        }
      ]
    };
    fetchWorkflowAssetPartitionsMock.mockResolvedValue(partitions);

    const { result } = renderHook(() => useWorkflowsController(), { wrapper });

    await waitFor(() => expect(result.current.selectedSlug).toBe('demo-workflow'));
    await waitFor(() => expect(result.current.assetInventoryLoading).toBe(false));

    await act(async () => {
      result.current.selectAsset('inventory.dataset');
    });

    await waitFor(() => expect(result.current.assetDetailLoading).toBe(false));
    expect(fetchWorkflowAssetHistoryMock).toHaveBeenCalledTimes(1);
    const historyCall = fetchWorkflowAssetHistoryMock.mock.calls[0];
    expect(historyCall[1]).toBe('demo-workflow');
    expect(historyCall[2]).toBe('inventory.dataset');
    expect(result.current.assetDetail).toEqual(assetDetail);
    expect(result.current.selectedAssetId).toBe('inventory.dataset');
    await waitFor(() => expect(fetchWorkflowAssetPartitionsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.assetPartitionsLoading).toBe(false));
    expect(result.current.assetPartitions).toEqual(partitions);

    fetchWorkflowAssetHistoryMock.mockClear();
    fetchWorkflowAssetPartitionsMock.mockClear();

    await act(async () => {
      result.current.selectAsset('inventory.dataset');
    });

    expect(fetchWorkflowAssetHistoryMock).not.toHaveBeenCalled();
    expect(fetchWorkflowAssetPartitionsMock).not.toHaveBeenCalled();
  });

  it('surfaces asset history errors with toast feedback', async () => {
    fetchWorkflowAssetsMock.mockResolvedValue([]);
    fetchWorkflowAssetHistoryMock.mockRejectedValueOnce(new Error('history failure'));

    const { result } = renderHook(() => useWorkflowsController(), { wrapper });

    await waitFor(() => expect(result.current.selectedSlug).toBe('demo-workflow'));
    await waitFor(() => expect(result.current.assetInventoryLoading).toBe(false));

    await act(async () => {
      result.current.selectAsset('inventory.dataset');
    });

    await waitFor(() => expect(result.current.assetDetailLoading).toBe(false));
    expect(result.current.assetDetailError).toBe('history failure');
    expect(pushToastMock).toHaveBeenCalledWith({
      title: 'Workflow asset history',
      description: 'history failure',
      tone: 'error'
    });
  });

  it('handles asset inventory load failures gracefully', async () => {
    const { ApiError } = await import('../../api');
    fetchWorkflowAssetsMock.mockRejectedValueOnce(new ApiError('inventory failure', 500));

    const { result } = renderHook(() => useWorkflowsController(), { wrapper });

    await waitFor(() => expect(result.current.selectedSlug).toBe('demo-workflow'));
    await waitFor(() => expect(fetchWorkflowAssetsMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.assetInventoryError).toBe('inventory failure'));

    expect(pushToastMock).toHaveBeenCalledWith({
      title: 'Workflow assets',
      description: 'inventory failure',
      tone: 'error'
    });
  });
});
