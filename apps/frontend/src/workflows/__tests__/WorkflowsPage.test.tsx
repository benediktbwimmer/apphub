import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import WorkflowsPage from '../WorkflowsPage';
import { ApiTokenProvider } from '../../auth/ApiTokenContext';
import { ToastProvider } from '../../components/toast';
import type { WorkflowDefinition, WorkflowRun, WorkflowRunStep } from '../types';

type FetchArgs = Parameters<typeof fetch>;

const nowTimestamp = Date.now();
const nowIso = new Date(nowTimestamp).toISOString();
const fiveMinutesAgoIso = new Date(nowTimestamp - 5 * 60 * 1000).toISOString();
const fourMinutesAgoIso = new Date(nowTimestamp - 4 * 60 * 1000).toISOString();

const workflowDefinition: WorkflowDefinition = {
  id: 'wf-1',
  slug: 'demo-workflow',
  name: 'Demo Workflow',
  description: 'Test workflow for vitest',
  version: 1,
  steps: [
    {
      id: 'step-one',
      name: 'First Step',
      jobSlug: 'job-step-one',
      dependsOn: [],
      dependents: ['step-two']
    },
    {
      id: 'step-two',
      name: 'Second Step',
      jobSlug: 'job-step-two',
      dependsOn: ['step-one'],
      dependents: []
    }
  ],
  triggers: [{ type: 'manual' }],
  parametersSchema: {
    type: 'object',
    required: ['tenant'],
    properties: {
      tenant: { type: 'string', description: 'Tenant identifier' },
      retries: { type: 'integer', default: 1 }
    }
  },
  defaultParameters: {
    tenant: 'acme',
    retries: 1
  },
  outputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string' }
    }
  },
  metadata: {
    repo: 'git@example.com/demo.git',
    tags: ['env:test'],
    status: 'succeeded'
  },
  dag: {
    roots: ['step-one'],
    adjacency: {
      'step-one': ['step-two'],
      'step-two': []
    },
    topologicalOrder: ['step-one', 'step-two'],
    edges: 1
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const runResponse: WorkflowRun = {
  id: 'run-1',
  workflowDefinitionId: workflowDefinition.id,
  status: 'pending',
  currentStepId: null,
  currentStepIndex: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
  errorMessage: null,
  triggeredBy: 'operator@apphub.test',
  partitionKey: null,
  metrics: { totalSteps: 2, completedSteps: 0 },
  parameters: { tenant: 'umbrella', retries: 2 },
  context: {},
  output: null,
  trigger: { type: 'manual' },
  createdAt: nowIso,
  updatedAt: nowIso
};

const completedRun: WorkflowRun = {
  ...runResponse,
  id: 'run-2',
  status: 'succeeded',
  currentStepId: null,
  currentStepIndex: null,
  startedAt: fiveMinutesAgoIso,
  completedAt: fourMinutesAgoIso,
  durationMs: 60_000,
  metrics: { totalSteps: 2, completedSteps: 2 },
  createdAt: fiveMinutesAgoIso,
  updatedAt: fourMinutesAgoIso
};

const runStepsResponse: WorkflowRunStep[] = [
  {
    id: 'run-step-1',
    workflowRunId: runResponse.id,
    stepId: 'step-one',
    status: 'running',
    attempt: 1,
    jobRunId: 'job-run-1',
    startedAt: new Date().toISOString(),
    completedAt: null,
    errorMessage: null,
    logsUrl: 'https://example.com/logs/1',
    metrics: { durationMs: 1200 }
  }
];

const completedRunSteps: WorkflowRunStep[] = [
  {
    id: 'run-step-2',
    workflowRunId: completedRun.id,
    stepId: 'step-two',
    status: 'succeeded',
    attempt: 1,
    jobRunId: 'job-run-2',
    startedAt: fiveMinutesAgoIso,
    completedAt: fourMinutesAgoIso,
    errorMessage: null,
    logsUrl: 'https://example.com/logs/2',
    metrics: { durationMs: 2000 }
  }
];

class WebSocketMock {
  static instances: WebSocketMock[] = [];
  public readyState: number = 1;
  public onopen: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public url: string;

  constructor(url: string) {
    this.url = url;
    WebSocketMock.instances.push(this);
    setTimeout(() => {
      this.onopen?.(new Event('open'));
    }, 0);
  }
  send(): void {}
  close(): void {
    this.readyState = 3;
    this.onclose?.({} as CloseEvent);
  }
}

type FetchMockOptions = {
  workflow?: WorkflowDefinition;
  services?: { slug: string; status: string }[];
  run?: WorkflowRun;
  runSteps?: WorkflowRunStep[];
  detailRuns?: WorkflowRun[];
  runStepsById?: Record<string, WorkflowRunStep[]>;
};

function createFetchMock(options?: FetchMockOptions) {
  const workflow = options?.workflow ?? workflowDefinition;
  const services = options?.services ?? [];
  const run = options?.run ?? runResponse;
  const steps = options?.runSteps ?? runStepsResponse;
  const detailRuns = options?.detailRuns ?? [];
  const runStepsById: Record<string, WorkflowRunStep[]> = {
    [run.id]: steps,
    ...(options?.runStepsById ?? {})
  };
  const now = new Date().toISOString();
  const statsPayload = {
    workflowId: workflow.id,
    slug: workflow.slug,
    range: { from: now, to: now, key: '7d' },
    totalRuns: 5,
    statusCounts: { succeeded: 3, failed: 2 },
    successRate: 0.6,
    failureRate: 0.4,
    averageDurationMs: 1200,
    failureCategories: [{ category: 'timeout', count: 1 }]
  } as const;
  const metricsPayload = {
    workflowId: workflow.id,
    slug: workflow.slug,
    range: { from: now, to: now, key: '7d' },
    bucketInterval: '1 hour',
    bucket: { interval: '1 hour', key: 'hour' as const },
    series: [
      {
        bucketStart: now,
        bucketEnd: now,
        totalRuns: 2,
        statusCounts: { succeeded: 1, failed: 1 },
        averageDurationMs: 900,
        rollingSuccessCount: 1
      }
    ]
  } as const;

  return vi.fn(async (...args: FetchArgs) => {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input.toString();

    if (url.endsWith('/services')) {
      return new Response(
        JSON.stringify({ data: services }),
        { status: 200 }
      );
    }

    if (url.endsWith('/workflows') && (!init || init.method === undefined)) {
      return new Response(JSON.stringify({ data: [workflow] }), { status: 200 });
    }

    if (url.endsWith(`/workflows/${workflow.slug}`) && (!init || init.method === undefined)) {
      return new Response(
        JSON.stringify({ data: { workflow, runs: detailRuns } }),
        { status: 200 }
      );
    }

    if (url.endsWith(`/workflows/${workflow.slug}/run`) && init?.method === 'POST') {
      const body = init.body ? JSON.parse(init.body as string) : {};
      expect(body.parameters).toEqual({ tenant: 'umbrella', retries: 2 });
      expect(body.triggeredBy).toBe('operator@apphub.test');
      return new Response(JSON.stringify({ data: run }), { status: 202 });
    }

    if (url.includes(`/workflows/${workflow.slug}/stats`)) {
      return new Response(JSON.stringify({ data: statsPayload }), { status: 200 });
    }

    if (url.includes(`/workflows/${workflow.slug}/run-metrics`)) {
      return new Response(JSON.stringify({ data: metricsPayload }), { status: 200 });
    }

    if (/\/workflow-runs\/.+\/steps$/.test(url)) {
      const match = url.match(/\/workflow-runs\/([^/]+)\/steps$/);
      const runId = match?.[1];
      if (runId) {
        const responseRun =
          detailRuns.find((entry) => entry.id === runId) ?? (run.id === runId ? run : detailRuns[0] ?? run);
        const responseSteps = runStepsById[runId] ?? steps;
        return new Response(
          JSON.stringify({ data: { run: responseRun, steps: responseSteps } }),
          { status: 200 }
        );
      }
    }

    return new Response('not found', { status: 404 });
  });
}

function renderWorkflowsPage(initialEntries: string[] = ['/workflows']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <ToastProvider>
        <ApiTokenProvider>
          <WorkflowsPage />
        </ApiTokenProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('WorkflowsPage manual run flow', () => {
  beforeEach(() => {
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocketMock as unknown as typeof WebSocket;
    const now = new Date().toISOString();
    window.localStorage.setItem("apphub.apiTokens.v1", JSON.stringify([{ id: 'test-token', label: 'Test token', token: 'test-token-value', createdAt: now, lastUsedAt: null }]));
    window.localStorage.setItem("apphub.activeTokenId.v1", 'test-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    WebSocketMock.instances = [];
    window.localStorage.clear();
  });

  it('submits manual run parameters and surfaces run + step data', async () => {
    const fetchMock = createFetchMock();
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    renderWorkflowsPage();

    await waitFor(() => {
      expect(screen.getByText('Demo Workflow')).toBeVisible();
    });

    await screen.findByText(/Triggers: manual/i);

    const tenantInput = await screen.findByLabelText(/tenant/i);
    await userEvent.clear(tenantInput);
    await userEvent.type(tenantInput, 'umbrella');

    const retriesInput = await screen.findByLabelText(/retries/i);
    await userEvent.clear(retriesInput);
    await userEvent.type(retriesInput, '2');

    const triggeredByInput = await screen.findByPlaceholderText('you@example.com');
    await userEvent.clear(triggeredByInput);
    await userEvent.type(triggeredByInput, 'operator@apphub.test');

    const submitButton = screen.getByRole('button', { name: /launch workflow/i });
    expect(submitButton).toBeEnabled();
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/workflows\/demo-workflow\/run$/), expect.anything());
    });

    const stepRow = await screen.findByText('step-one');
    expect(stepRow).toBeVisible();
    const logLinks = screen.getAllByRole('link', { name: /view/i });
    expect(logLinks.some((link) => link.getAttribute('href') === 'https://example.com/logs/1')).toBe(true);
    expect(screen.getAllByText(/operator@apphub.test/i).length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByText(/Run analytics/i)).toBeVisible();
    });

    const rangeSelect = screen.getByLabelText(/Time range/i) as HTMLSelectElement;
    expect(rangeSelect.value).toBe('7d');
    await userEvent.selectOptions(rangeSelect, ['24h']);
    await waitFor(() => {
      expect(
        fetchMock
          .mock.calls
          .some(([request]) =>
            typeof request === 'string' && request.includes('/workflows/demo-workflow/stats?range=24h')
          )
      ).toBe(true);
    });

    const failedCheckbox = await screen.findByLabelText(/failed/i);
    expect(failedCheckbox).toBeChecked();
    await userEvent.click(failedCheckbox);
    expect(failedCheckbox).not.toBeChecked();
  });

  it('disables manual runs when a required service is unreachable', async () => {
    const serviceWorkflow: WorkflowDefinition = {
      ...workflowDefinition,
      id: 'wf-service',
      slug: 'service-workflow',
      name: 'Service Workflow',
      steps: [
        ...workflowDefinition.steps,
        {
          id: 'service-step',
          name: 'Reach service',
          serviceSlug: 'demo-service',
          dependsOn: []
        }
      ]
    };

    const fetchMock = createFetchMock({
      workflow: serviceWorkflow,
      services: [{ slug: 'demo-service', status: 'unreachable' }]
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    renderWorkflowsPage();

    await waitFor(() => {
      expect(screen.getByText('Service Workflow')).toBeVisible();
    });

    const warning = await screen.findByText(/cannot launch while the following services are unreachable/i);
    expect(warning).toBeVisible();
    expect(warning).toHaveTextContent('demo-service');

    const submitButton = await screen.findByRole('button', { name: /launch workflow/i });
    expect(submitButton).toBeDisabled();
  });

  it('selects the workflow and run indicated by query parameters', async () => {
    const fetchMock = createFetchMock({
      detailRuns: [{ ...runResponse }, completedRun],
      runStepsById: { [completedRun.id]: completedRunSteps }
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    renderWorkflowsPage([
      `/workflows?slug=${workflowDefinition.slug}&run=${completedRun.id}`
    ]);

    await waitFor(() => {
      expect(screen.getByText('Demo Workflow')).toBeVisible();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/workflow-runs/${completedRun.id}/steps`),
        expect.anything()
      );
    });

    expect(await screen.findByText(/Run ID: run-2/i)).toBeVisible();
  });
});
