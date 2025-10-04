import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockedFunction } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import WorkflowsPage from '../WorkflowsPage';
import { ToastProvider } from '../../components/toast';
import { useAuth } from '../../auth/useAuth';
import type { WorkflowDefinition, WorkflowRun, WorkflowRunStep } from '../types';
import {
  AppHubEventsContext,
  type AppHubConnectionHandler,
  type AppHubEventHandler,
  type AppHubEventsClient
} from '../../events/context';

vi.mock('../../auth/useAuth', () => {
  const useAuthMock = vi.fn();
  const AuthProviderMock = ({ children }: PropsWithChildren<unknown>) => <>{children}</>;
  return {
    useAuth: useAuthMock,
    AuthProvider: AuthProviderMock
  };
});

const mockedUseAuth = useAuth as unknown as MockedFunction<typeof useAuth>;

type FetchArgs = Parameters<typeof fetch>;

const nowTimestamp = Date.now();
const nowIso = new Date(nowTimestamp).toISOString();
const fiveMinutesAgoIso = new Date(nowTimestamp - 5 * 60 * 1000).toISOString();
const fourMinutesAgoIso = new Date(nowTimestamp - 4 * 60 * 1000).toISOString();

function createAuthMockValue() {
  return {
    identity: {
      subject: 'user@example.com',
      kind: 'user' as const,
      scopes: ['workflows:read', 'workflows:run', 'workflows:write', 'jobs:write', 'job-bundles:write'],
      authDisabled: false,
      userId: 'usr_1',
      sessionId: 'sess_1',
      apiKeyId: null,
      displayName: 'Test User',
      email: 'user@example.com',
      roles: ['admin']
    },
    identityLoading: false,
    identityError: null,
    refreshIdentity: vi.fn(),
    apiKeys: [],
    apiKeysLoading: false,
    apiKeysError: null,
    refreshApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
    activeToken: null,
    setActiveToken: vi.fn()
  };
}

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
  schedules: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const runResponse: WorkflowRun = {
  id: 'run-1',
  workflowDefinitionId: workflowDefinition.id,
  status: 'pending',
  health: 'healthy',
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
  updatedAt: nowIso,
  retrySummary: {
    pendingSteps: 0,
    overdueSteps: 0,
    nextAttemptAt: null
  }
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

const autoRun: WorkflowRun = {
  ...completedRun,
  id: 'auto-run-1',
  status: 'failed',
  health: 'degraded',
  triggeredBy: 'asset-materializer',
  trigger: {
    type: 'auto-materialize',
    reason: 'upstream-update',
    assetId: 'asset.auto.demo',
    partitionKey: '2025-01-01'
  },
  startedAt: fourMinutesAgoIso,
  completedAt: nowIso,
  durationMs: 90_000,
  createdAt: fourMinutesAgoIso,
  updatedAt: nowIso
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

type FetchMockOptions = {
  workflow?: WorkflowDefinition;
  services?: { slug: string; status: string }[];
  run?: WorkflowRun;
  runSteps?: WorkflowRunStep[];
  detailRuns?: WorkflowRun[];
  runStepsById?: Record<string, WorkflowRunStep[]>;
  autoOps?: {
    runs?: WorkflowRun[];
    inFlight?: Record<string, unknown> | null;
    cooldown?: Record<string, unknown> | null;
    updatedAt?: string;
  };
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
  const autoOps = options?.autoOps ?? {};
  const autoOpsPayload = {
    runs: autoOps.runs ?? [autoRun],
    inFlight: autoOps.inFlight ?? null,
    cooldown: autoOps.cooldown ?? null,
    updatedAt: autoOps.updatedAt ?? now
  };
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
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input instanceof Request
          ? input.url
          : input.toString();
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = new URL(rawUrl, 'http://localhost');
    const pathname = url.pathname;

    if (pathname === '/services' && method === 'GET') {
      return new Response(
        JSON.stringify({ data: services }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (pathname === '/workflows' && method === 'GET') {
      return new Response(JSON.stringify({ data: [workflow] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (pathname === `/workflows/${workflow.slug}` && method === 'GET') {
      return new Response(
        JSON.stringify({ data: { workflow, runs: detailRuns } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (pathname === `/workflows/${workflow.slug}/assets` && method === 'GET') {
      return new Response(
        JSON.stringify({ data: { assets: [] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (pathname === `/workflows/${workflow.slug}/auto-materialize` && method === 'GET') {
      return new Response(
        JSON.stringify({
          data: autoOpsPayload,
          meta: {
            workflow: { id: workflow.id, slug: workflow.slug, name: workflow.name },
            limit: 20,
            offset: 0
          }
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (pathname === `/workflows/${workflow.slug}/run` && method === 'POST') {
      const bodyRaw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
      const body = bodyRaw ? JSON.parse(typeof bodyRaw === 'string' ? bodyRaw : String(bodyRaw)) : {};
      expect(body.parameters).toEqual({ tenant: 'umbrella', retries: 2 });
      expect(body.triggeredBy).toBe('operator@apphub.test');
      return new Response(JSON.stringify({ data: run }), { status: 202 });
    }

    if (pathname === `/workflows/${workflow.slug}/stats` && method === 'GET') {
      return new Response(JSON.stringify({ data: statsPayload }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (pathname === `/workflows/${workflow.slug}/run-metrics` && method === 'GET') {
      return new Response(JSON.stringify({ data: metricsPayload }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (/^\/workflow-runs\/.+\/steps$/.test(pathname)) {
      const match = pathname.match(/^\/workflow-runs\/([^/]+)\/steps$/);
      const runId = match?.[1];
      if (runId) {
        const responseRun =
          detailRuns.find((entry) => entry.id === runId) ?? (run.id === runId ? run : detailRuns[0] ?? run);
        const responseSteps = runStepsById[runId] ?? steps;
        return new Response(
          JSON.stringify({ data: { run: responseRun, steps: responseSteps } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response('not found', { status: 404 });
  });
}

function renderWorkflowsPage(initialEntries: string[] = ['/workflows']) {
  const subscribers = new Set<AppHubEventHandler>();
  const connectionHandlers = new Set<AppHubConnectionHandler>();
  const client: AppHubEventsClient = {
    subscribe: (handler) => {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },
    subscribeConnection: (handler) => {
      handler('connected');
      connectionHandlers.add(handler);
      return () => {
        connectionHandlers.delete(handler);
      };
    },
    getConnectionState: () => 'connected'
  };
  return render(
    createElement(
      AppHubEventsContext.Provider,
      { value: client },
      createElement(
        MemoryRouter,
        { initialEntries },
        createElement(
          ToastProvider,
          null,
          createElement(WorkflowsPage)
        )
      )
    )
  );
}

describe('WorkflowsPage manual run flow', () => {
  beforeEach(() => {
    mockedUseAuth.mockReturnValue(createAuthMockValue());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockedUseAuth.mockReset();
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

    const stepRow = await screen.findByText('First Step');
    expect(stepRow).toBeVisible();
    const logLinks = await screen.findAllByRole('link', { name: /^view$/i });
    const logHrefs = logLinks.map((link) => link.getAttribute('href'));
    expect(logHrefs).toContain('https://example.com/logs/1');
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

  it('renders auto-materialization activity and supports filtering', async () => {
    const secondAutoRun: WorkflowRun = {
      ...autoRun,
      id: 'auto-run-2',
      status: 'succeeded',
      health: 'healthy',
      trigger: {
        type: 'auto-materialize',
        reason: 'expiry',
        assetId: 'asset.auto.secondary',
        partitionKey: '2025-01-02'
      }
    };

    const fetchMock = createFetchMock({
      autoOps: {
        runs: [autoRun, secondAutoRun],
        inFlight: {
          workflowRunId: autoRun.id,
          reason: 'upstream-update',
          assetId: 'asset.auto.demo',
          partitionKey: '2025-01-01',
          requestedAt: nowIso,
          claimedAt: nowIso,
          claimOwner: 'materializer-1',
          context: null
        },
        cooldown: {
          failures: 2,
          nextEligibleAt: new Date(nowTimestamp + 60 * 1000).toISOString()
        }
      }
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    renderWorkflowsPage();

    await screen.findByText('Auto-Materialization Activity');

    await screen.findByText(/In-flight claim/i);
    expect(screen.getAllByText('asset.auto.demo').length).toBeGreaterThan(0);

    const tableRun = await screen.findByText('auto-run-1');
    expect(tableRun).toBeVisible();
    expect(screen.getByText('auto-run-2')).toBeVisible();

    const assetSelect = await screen.findByLabelText(/Filter by asset/i);
    await userEvent.selectOptions(assetSelect, ['asset.auto.secondary']);

    await waitFor(() => {
      expect(screen.queryByText('auto-run-1')).toBeNull();
    });
    expect(screen.getByText('auto-run-2')).toBeVisible();

    const statusSelect = await screen.findByLabelText(/Filter by status/i);
    await userEvent.selectOptions(statusSelect, ['failed']);

    await waitFor(() => {
      expect(screen.getByText('No runs match the selected filters.')).toBeVisible();
    });
  });
});
