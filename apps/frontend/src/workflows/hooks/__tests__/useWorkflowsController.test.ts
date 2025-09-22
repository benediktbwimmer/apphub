import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinition, WorkflowRun, WorkflowRunStep } from '../../types';

const {
  workflowDefinition,
  runResponse,
  listWorkflowDefinitionsMock,
  getWorkflowDetailMock,
  listWorkflowRunStepsMock,
  listServicesMock,
  createWorkflowDefinitionMock,
  updateWorkflowDefinitionMock,
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

class TestSocket {
  static instances: TestSocket[] = [];
  url: string;
  readyState = 1;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn(() => {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  });
  send = vi.fn();
  constructor(url: string) {
    this.url = url;
    TestSocket.instances.push(this);
    setTimeout(() => {
      this.onopen?.({} as Event);
    }, 0);
  }
}

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
    fetchOperatorIdentity: fetchOperatorIdentityMock
  };
});

import { useWorkflowsController } from '../useWorkflowsController';

beforeEach(() => {
  (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = class {
    static OPEN = 1;
    static CLOSED = 3;
  } as unknown as typeof WebSocket;
  activeTokenMock = { id: 'token-1' };
  authorizedFetchMock.mockClear();
  pushToastMock.mockClear();
  listWorkflowDefinitionsMock.mockClear();
  getWorkflowDetailMock.mockClear();
  listWorkflowRunStepsMock.mockClear();
  TestSocket.instances = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useWorkflowsController', () => {
  it('loads workflows and refreshes run data', async () => {
    const { result, unmount } = renderHook(() =>
      useWorkflowsController({
        createWebSocket: (url) => new TestSocket(url) as unknown as WebSocket
      })
    );

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

    unmount();
    expect(TestSocket.instances[0]?.close).toHaveBeenCalled();
  });

  it('prevents manual runs when no active token is configured', async () => {
    activeTokenMock = null;

    const { result } = renderHook(() =>
      useWorkflowsController({
        createWebSocket: (url) => new TestSocket(url) as unknown as WebSocket
      })
    );

    await waitFor(() => expect(result.current.workflowsLoading).toBe(false));
    await waitFor(() => expect(listWorkflowDefinitionsMock).toHaveBeenCalled());
    await waitFor(() => expect(result.current.workflows).toHaveLength(1));
    await waitFor(() => expect(result.current.selectedSlug).toBe('demo-workflow'));

    await act(async () => {
      await result.current.handleManualRun({ parameters: {} });
    });

    expect(result.current.manualRunError).toContain('Add an operator token');
  });
});
