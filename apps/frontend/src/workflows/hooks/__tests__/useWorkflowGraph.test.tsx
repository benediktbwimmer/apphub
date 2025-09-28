import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowTopologyGraph } from '@apphub/shared/workflowTopology';
import { WorkflowGraphProvider, useWorkflowGraph } from '../useWorkflowGraph';

const { mockFetchWorkflowTopologyGraph, appHubSubscribers, accessContextMock } = vi.hoisted(() => {
  const pushToast = vi.fn();
  return {
    mockFetchWorkflowTopologyGraph: vi.fn(),
    appHubSubscribers: new Set<(event: { type: string; data?: unknown }) => void>(),
    accessContextMock: {
      authorizedFetch: vi.fn(),
      pushToast,
      identity: null,
      identityScopes: new Set<string>(),
      isAuthenticated: false,
      canRunWorkflowsScope: false,
      canEditWorkflows: false,
      canUseAiBuilder: false,
      canCreateAiJobs: false
    }
  };
});

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return {
    ...actual,
    fetchWorkflowTopologyGraph: mockFetchWorkflowTopologyGraph
  } satisfies Partial<typeof actual>;
});

vi.mock('../useWorkflowAccess', () => ({
  useWorkflowAccess: () => accessContextMock
}));

export const emitMockAppHubEvent = (event: { type: string; data?: unknown }) => {
  appHubSubscribers.forEach((handler) => handler(event));
};

vi.mock('../../../events/context', () => ({
  useAppHubEvent: (_types: unknown, handler: (event: { type: string; data?: unknown }) => void) => {
    appHubSubscribers.add(handler);
    return () => {
      appHubSubscribers.delete(handler);
    };
  }
}));

const GRAPH_V1: WorkflowTopologyGraph = {
  version: 'v1',
  generatedAt: '2024-04-02T00:00:00.000Z',
  nodes: {
    workflows: [
      {
        id: 'wf-1',
        slug: 'demo',
        name: 'Demo',
        version: 1,
        description: null,
        createdAt: '2024-04-01T00:00:00.000Z',
        updatedAt: '2024-04-01T00:00:00.000Z',
        metadata: null,
        annotations: { tags: [] }
      }
    ],
    steps: [
      {
        id: 'start',
        workflowId: 'wf-1',
        name: 'Start',
        description: null,
        type: 'job',
        dependsOn: [],
        dependents: ['finish'],
        runtime: {
          type: 'job',
          jobSlug: 'demo.start'
        }
      },
      {
        id: 'finish',
        workflowId: 'wf-1',
        name: 'Finish',
        description: null,
        type: 'job',
        dependsOn: ['start'],
        dependents: [],
        runtime: {
          type: 'job',
          jobSlug: 'demo.finish'
        }
      }
    ],
    triggers: [],
    schedules: [],
    assets: [],
    eventSources: []
  },
  edges: {
    triggerToWorkflow: [],
    workflowToStep: [
      {
        workflowId: 'wf-1',
        fromStepId: null,
        toStepId: 'start'
      },
      {
        workflowId: 'wf-1',
        fromStepId: 'start',
        toStepId: 'finish'
      }
    ],
    stepToAsset: [],
    assetToWorkflow: [],
    eventSourceToTrigger: []
  }
};

const UPDATED_GRAPH: WorkflowTopologyGraph = {
  ...GRAPH_V1,
  generatedAt: '2024-04-02T00:00:01.000Z'
};

describe('useWorkflowGraph', () => {
  beforeEach(() => {
    mockFetchWorkflowTopologyGraph.mockReset();
    accessContextMock.authorizedFetch.mockReset();
    mockFetchWorkflowTopologyGraph.mockResolvedValue({ graph: GRAPH_V1, meta: { cache: null } });
    accessContextMock.pushToast.mockReset();
    appHubSubscribers.clear();
  });

  it('loads and normalizes the workflow graph', async () => {
    const { result } = renderHook(() => useWorkflowGraph(), {
      wrapper: ({ children }) => <WorkflowGraphProvider>{children}</WorkflowGraphProvider>
    });

    await waitFor(() => expect(result.current.graphLoading).toBe(false));

    expect(mockFetchWorkflowTopologyGraph).toHaveBeenCalledTimes(1);
    expect(result.current.graph?.stats.totalSteps).toBe(2);
    expect(result.current.graphMeta).toEqual({ cache: null });
    expect(result.current.graphStale).toBe(false);
  });

  it('queues websocket events and dequeues them on demand', async () => {
    const { result } = renderHook(() => useWorkflowGraph(), {
      wrapper: ({ children }) => <WorkflowGraphProvider>{children}</WorkflowGraphProvider>
    });

    await waitFor(() => expect(result.current.graphLoading).toBe(false));

    act(() => {
      emitMockAppHubEvent({ type: 'workflow.run.updated', data: { run: { id: 'run-1' } } });
    });

    await waitFor(() => expect(result.current.pendingEvents.length).toBeGreaterThanOrEqual(1));
    let dequeued: ReturnType<typeof result.current.dequeuePendingEvents> = [];
    act(() => {
      dequeued = result.current.dequeuePendingEvents();
    });
    expect(Array.isArray(dequeued)).toBe(true);

    act(() => {
      emitMockAppHubEvent({ type: 'workflow.run.failed', data: { run: { id: 'run-2' } } });
      emitMockAppHubEvent({ type: 'workflow.run.running', data: { run: { id: 'run-3' } } });
    });

    await waitFor(() => expect(result.current.pendingEvents.length).toBeGreaterThanOrEqual(2));
    act(() => {
      result.current.clearPendingEvents();
    });
    expect(result.current.pendingEvents).toHaveLength(0);
  });

  it('marks the graph as stale and refreshes after workflow definition updates', async () => {
    mockFetchWorkflowTopologyGraph
      .mockResolvedValueOnce({ graph: GRAPH_V1, meta: { cache: null } })
      .mockResolvedValueOnce({ graph: UPDATED_GRAPH, meta: { cache: { hit: false } } });

    const { result } = renderHook(() => useWorkflowGraph(), {
      wrapper: ({ children }) => <WorkflowGraphProvider>{children}</WorkflowGraphProvider>
    });

    await waitFor(() => expect(result.current.graphLoading).toBe(false));
    expect(result.current.graph?.generatedAt).toBe('2024-04-02T00:00:00.000Z');

    act(() => {
      emitMockAppHubEvent({ type: 'workflow.definition.updated', data: { workflow: { id: 'wf-1' } } });
    });

    expect(result.current.graphStale).toBe(true);

    await waitFor(() => expect(mockFetchWorkflowTopologyGraph).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.graphStale).toBe(false));

    expect(result.current.graph?.generatedAt).toBe('2024-04-02T00:00:01.000Z');
    expect(result.current.graphMeta).toEqual({ cache: { hit: false } });
  });
});
