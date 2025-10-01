import { setTimeout as sleep } from 'node:timers/promises';
import type { ObservatoryContext } from './observatory';
import { requestJson } from './httpClient';

type WorkflowRunPayload = {
  data: {
    id: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'canceled';
    errorMessage?: string | null;
  };
};

type WorkflowDefinitionPayload = {
  data: {
    slug: string;
    defaultParameters?: Record<string, unknown> | null;
  };
};

export async function waitForWorkflowRun(
  context: ObservatoryContext,
  runId: string,
  timeoutMs = 180_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await requestJson<WorkflowRunPayload>(
      `${context.coreBaseUrl}/workflow-runs/${runId}`,
      {
        token: context.coreToken,
        expectedStatus: 200
      }
    );

    if (response.data.status === 'completed') {
      return;
    }
    if (response.data.status === 'failed' || response.data.status === 'canceled') {
      throw new Error(
        `Workflow run ${runId} ended with status ${response.data.status}: ${response.data.errorMessage ?? 'no error message'}`
      );
    }

    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for workflow run ${runId}`);
}

export async function triggerGeneratorWorkflow(context: ObservatoryContext): Promise<void> {
  const generatorSlug =
    context.config.workflows.generatorSlug ?? 'observatory-minute-data-generator';

  const definition = await requestJson<WorkflowDefinitionPayload>(
    `${context.coreBaseUrl}/workflows/${generatorSlug}`,
    {
      token: context.coreToken,
      expectedStatus: 200
    }
  );

  const defaults = definition.data.defaultParameters ?? {};
  const minuteIso = new Date().toISOString().slice(0, 16);

  const parameters = {
    ...defaults,
    minute: minuteIso
  } satisfies Record<string, unknown>;

  const runResponse = await requestJson<WorkflowRunPayload>(
    `${context.coreBaseUrl}/workflows/${generatorSlug}/run`,
    {
      method: 'POST',
      token: context.coreToken,
      body: { parameters },
      expectedStatus: 202
    }
  );

  await waitForWorkflowRun(context, runResponse.data.id);
}
