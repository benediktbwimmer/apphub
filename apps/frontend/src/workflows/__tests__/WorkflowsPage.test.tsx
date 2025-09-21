import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkflowsPage from '../WorkflowsPage';
import type { WorkflowDefinition, WorkflowRun, WorkflowRunStep } from '../types';

type FetchArgs = Parameters<typeof fetch>;

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
      dependsOn: []
    },
    {
      id: 'step-two',
      name: 'Second Step',
      jobSlug: 'job-step-two',
      dependsOn: ['step-one']
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
  metadata: {
    repo: 'git@example.com/demo.git',
    tags: ['env:test'],
    status: 'succeeded'
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
  metrics: { totalSteps: 2, completedSteps: 0 },
  parameters: { tenant: 'umbrella', retries: 2 },
  context: {},
  trigger: { type: 'manual' },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
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

function createFetchMock() {
  return vi.fn(async (...args: FetchArgs) => {
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input.toString();

    if (url.endsWith('/workflows') && (!init || init.method === undefined)) {
      return new Response(JSON.stringify({ data: [workflowDefinition] }), { status: 200 });
    }

    if (url.endsWith(`/workflows/${workflowDefinition.slug}`) && (!init || init.method === undefined)) {
      return new Response(
        JSON.stringify({ data: { workflow: workflowDefinition, runs: [] } }),
        { status: 200 }
      );
    }

    if (url.endsWith(`/workflows/${workflowDefinition.slug}/run`) && init?.method === 'POST') {
      const body = init.body ? JSON.parse(init.body as string) : {};
      expect(body.parameters).toEqual({ tenant: 'umbrella', retries: 2 });
      expect(body.triggeredBy).toBe('operator@apphub.test');
      return new Response(JSON.stringify({ data: runResponse }), { status: 202 });
    }

    if (url.endsWith(`/workflow-runs/${runResponse.id}/steps`)) {
      return new Response(
        JSON.stringify({ data: { run: runResponse, steps: runStepsResponse } }),
        { status: 200 }
      );
    }

    return new Response('not found', { status: 404 });
  });
}

describe('WorkflowsPage manual run flow', () => {
  beforeEach(() => {
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = WebSocketMock as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    WebSocketMock.instances = [];
  });

  it('submits manual run parameters and surfaces run + step data', async () => {
    const fetchMock = createFetchMock();
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    render(<WorkflowsPage />);

    await waitFor(() => {
      expect(screen.getByText('Demo Workflow')).toBeVisible();
    });

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
    await userEvent.click(submitButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/\/workflows\/demo-workflow\/run$/), expect.anything());
    });

    const runDetailsHeading = await screen.findByText(/run details/i);
    const runDetailsSection = runDetailsHeading.closest('section');
    expect(runDetailsSection).not.toBeNull();
    const details = within(runDetailsSection as HTMLElement);
    expect(details.getByText('step-one')).toBeVisible();
    expect(details.getByRole('link', { name: /view/i })).toHaveAttribute('href', 'https://example.com/logs/1');
    expect(details.getByText(/operator@apphub.test/i)).toBeVisible();
  });
});
