import { requestJson } from './http';
import { CORE_BASE_URL, OPERATOR_TOKEN } from './env';

export interface CoreClientOptions {
  baseUrl?: string;
  token?: string;
}

export interface WorkflowRun {
  id: string;
  workflowDefinitionId: string;
  status: string;
  runKey: string | null;
  parameters: Record<string, unknown> | null;
  output: unknown;
  triggeredBy: string | null;
  trigger: Record<string, unknown> | null;
  partitionKey: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface WorkflowRunResponse {
  data: WorkflowRun;
}

export interface WorkflowRunListResponse {
  data: {
    runs: WorkflowRun[];
  };
}

export class CoreClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(options: CoreClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? CORE_BASE_URL;
    this.token = options.token ?? OPERATOR_TOKEN;
  }

  private resolve(pathname: string): string {
    return new URL(pathname, `${this.baseUrl.replace(/\/+$/, '')}/`).toString();
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async runWorkflow(slug: string, body: Record<string, unknown> = {}): Promise<WorkflowRun> {
    const response = await requestJson<WorkflowRunResponse>(this.resolve(`/workflows/${slug}/run`), {
      method: 'POST',
      headers: this.authHeaders(),
      body,
      expectedStatus: 202
    });
    return response.payload.data;
  }

  async getWorkflowRun(runId: string): Promise<WorkflowRun> {
    const response = await requestJson<{ data: WorkflowRun }>(this.resolve(`/workflow-runs/${runId}`), {
      headers: this.authHeaders(),
      expectedStatus: 200
    });
    return response.payload.data;
  }

  async listWorkflowRuns(slug: string, limit = 5): Promise<WorkflowRun[]> {
    const response = await requestJson<WorkflowRunListResponse>(
      this.resolve(`/workflows/${slug}/runs?limit=${limit}`),
      {
        headers: this.authHeaders(),
        expectedStatus: 200
      }
    );
    return response.payload.data.runs ?? [];
  }
}

export type WorkflowStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type WaitForRunPollPhase =
  | 'list'
  | 'found'
  | 'empty'
  | 'status'
  | 'sleep'
  | 'error'
  | 'timeout';

export interface WaitForRunPollEvent {
  attempt: number;
  phase: WaitForRunPollPhase;
  slug?: string;
  runId?: string;
  status?: string | null;
  remainingMs: number;
  note?: string;
}

export interface WaitForRunOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  acceptableStatuses?: WorkflowStatus[];
  onPoll?: (event: WaitForRunPollEvent) => void;
  slug?: string;
}

export async function waitForRunStatus(
  client: CoreClient,
  runId: string,
  targetStatuses: WorkflowStatus[] = ['succeeded'],
  options: WaitForRunOptions = {}
): Promise<WorkflowRun> {
  const pollInterval = options.pollIntervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 240_000;
  const deadline = Date.now() + timeoutMs;
  const acceptable = new Set(targetStatuses);
  const slug = options.slug;
  let attempt = 0;

  while (Date.now() <= deadline) {
    attempt += 1;
    const run = await client.getWorkflowRun(runId);

    options.onPoll?.({
      attempt,
      phase: 'status',
      slug,
      runId,
      status: run.status,
      remainingMs: Math.max(0, deadline - Date.now())
    });

    if (acceptable.has(run.status as WorkflowStatus)) {
      return run;
    }

    if (run.status === 'failed') {
      options.onPoll?.({
        attempt,
        phase: 'error',
        slug,
        runId,
        status: run.status,
        remainingMs: Math.max(0, deadline - Date.now()),
        note: 'run failed'
      });
      throw new Error(`Workflow run ${runId} failed: ${JSON.stringify(run.output ?? run, null, 2)}`);
    }

    if (run.status === 'canceled') {
      options.onPoll?.({
        attempt,
        phase: 'error',
        slug,
        runId,
        status: run.status,
        remainingMs: Math.max(0, deadline - Date.now()),
        note: 'run canceled'
      });
      throw new Error(`Workflow run ${runId} was canceled`);
    }

    options.onPoll?.({
      attempt,
      phase: 'sleep',
      slug,
      runId,
      status: run.status,
      remainingMs: Math.max(0, deadline - Date.now()),
      note: 'waiting for next status poll'
    });

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  options.onPoll?.({
    attempt,
    phase: 'timeout',
    slug,
    runId,
    status: null,
    remainingMs: 0,
    note: 'run status wait timed out'
  });

  throw new Error(`Timed out waiting for workflow run ${runId} to reach ${targetStatuses.join(', ')}`);
}

export async function waitForLatestRun(
  client: CoreClient,
  slug: string,
  options: WaitForRunOptions & { after?: Date } = {}
): Promise<WorkflowRun> {
  const pollInterval = options.pollIntervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 240_000;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() <= deadline) {
    attempt += 1;
    options.onPoll?.({
      attempt,
      phase: 'list',
      slug,
      remainingMs: Math.max(0, deadline - Date.now()),
      note: 'fetching workflow runs'
    });

    const runs = await client.listWorkflowRuns(slug, 5);
    const candidate = runs.find((run) => {
      if (!options.after) {
        return true;
      }
      const created = run.createdAt ? Date.parse(run.createdAt) : Date.now();
      return created >= options.after.getTime();
    });

    if (candidate) {
      options.onPoll?.({
        attempt,
        phase: 'found',
        slug,
        runId: candidate.id,
        status: candidate.status,
        remainingMs: Math.max(0, deadline - Date.now()),
        note: 'candidate run located'
      });

      const remaining = Math.max(1_000, deadline - Date.now());

      return waitForRunStatus(client, candidate.id, options.acceptableStatuses ?? ['succeeded'], {
        pollIntervalMs: options.pollIntervalMs,
        timeoutMs: remaining,
        onPoll: options.onPoll,
        slug
      });
    }

    options.onPoll?.({
      attempt,
      phase: 'empty',
      slug,
      remainingMs: Math.max(0, deadline - Date.now()),
      note: 'no runs yet'
    });

    options.onPoll?.({
      attempt,
      phase: 'sleep',
      slug,
      remainingMs: Math.max(0, deadline - Date.now()),
      note: 'waiting before next run poll'
    });

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  options.onPoll?.({
    attempt,
    phase: 'timeout',
    slug,
    remainingMs: 0,
    note: 'latest run wait timed out'
  });

  throw new Error(`Timed out waiting for workflow ${slug} to produce a run`);
}
