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

export interface WaitForRunOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  acceptableStatuses?: WorkflowStatus[];
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

  while (Date.now() <= deadline) {
    const run = await client.getWorkflowRun(runId);
    if (acceptable.has(run.status as WorkflowStatus)) {
      return run;
    }

    if (run.status === 'failed') {
      throw new Error(`Workflow run ${runId} failed: ${JSON.stringify(run.output ?? run, null, 2)}`);
    }

    if (run.status === 'canceled') {
      throw new Error(`Workflow run ${runId} was canceled`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

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

  while (Date.now() <= deadline) {
    const runs = await client.listWorkflowRuns(slug, 5);
    const candidate = runs.find((run) => {
      if (!options.after) {
        return true;
      }
      const created = run.createdAt ? Date.parse(run.createdAt) : Date.now();
      return created >= options.after.getTime();
    });

    if (candidate) {
      return waitForRunStatus(client, candidate.id, options.acceptableStatuses ?? ['succeeded'], options);
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  throw new Error(`Timed out waiting for workflow ${slug} to produce a run`);
}
