import { setTimeout as sleep } from 'node:timers/promises';
import type { ObservatoryContext } from './observatory';
import { requestJson } from './httpClient';

function log(message: string, details?: Record<string, unknown>): void {
  if (details && Object.keys(details).length > 0) {
    console.info(`[workflow] ${message}`, details);
    return;
  }
  console.info(`[workflow] ${message}`);
}

type WorkflowRunPayload = {
  data: {
    id: string;
    status: 'pending' | 'running' | 'completed' | 'succeeded' | 'failed' | 'canceled';
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
  let lastStatus: string | null = null;
  while (Date.now() < deadline) {
    const response = await requestJson<WorkflowRunPayload>(
      `${context.coreBaseUrl}/workflow-runs/${runId}`,
      {
        token: context.coreToken,
        expectedStatus: 200
      }
    );

    if (response.data.status !== lastStatus) {
      log('Workflow run status update', {
        runId,
        status: response.data.status
      });
      lastStatus = response.data.status;
    }

    if (response.data.status === 'completed' || response.data.status === 'succeeded') {
      log('Workflow run completed', { runId, status: response.data.status });
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

  log('Fetching workflow definition', { slug: generatorSlug });
  const definition = await requestJson<WorkflowDefinitionPayload>(
    `${context.coreBaseUrl}/workflows/${generatorSlug}`,
    {
      token: context.coreToken,
      expectedStatus: 200
    }
  );

  const defaults = definition.data.defaultParameters ?? {};
  const minuteIso = new Date().toISOString().slice(0, 16);
  log('Preparing workflow parameters', { minute: minuteIso, defaults });

  const parameters = {
    ...defaults,
    minute: minuteIso
  } satisfies Record<string, unknown>;

  log('Requesting workflow run', { slug: generatorSlug, minute: minuteIso });
  const runResponse = await requestJson<WorkflowRunPayload>(
    `${context.coreBaseUrl}/workflows/${generatorSlug}/run`,
    {
      method: 'POST',
      token: context.coreToken,
      body: { parameters, partitionKey: minuteIso },
      expectedStatus: 202
    }
  );

  log('Workflow run accepted', { runId: runResponse.data.id });

  await waitForWorkflowRun(context, runResponse.data.id);
}
