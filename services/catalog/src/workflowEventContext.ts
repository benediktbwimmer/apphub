import { AsyncLocalStorage } from 'node:async_hooks';

export type WorkflowEventContext = {
  workflowDefinitionId: string;
  workflowRunId: string;
  workflowRunStepId: string;
  jobRunId: string;
  jobSlug: string;
};

export const WORKFLOW_EVENT_CONTEXT_ENV = 'APPHUB_WORKFLOW_EVENT_CONTEXT';

const storage = new AsyncLocalStorage<WorkflowEventContext>();

export function runWithWorkflowEventContext<T>(
  context: WorkflowEventContext,
  callback: () => T
): T {
  return storage.run(context, callback);
}

export function getWorkflowEventContext(): WorkflowEventContext | null {
  return storage.getStore() ?? null;
}

export function serializeWorkflowEventContext(context: WorkflowEventContext): string {
  try {
    return JSON.stringify(context);
  } catch (err) {
    throw new Error(
      `Failed to serialize workflow event context: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function parseWorkflowEventContext(
  raw: string | undefined | null
): WorkflowEventContext | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Partial<WorkflowEventContext>;
    if (!value || typeof value !== 'object') {
      return null;
    }
    const {
      workflowDefinitionId,
      workflowRunId,
      workflowRunStepId,
      jobRunId,
      jobSlug
    } = value as WorkflowEventContext;
    if (
      typeof workflowDefinitionId !== 'string' ||
      typeof workflowRunId !== 'string' ||
      typeof workflowRunStepId !== 'string' ||
      typeof jobRunId !== 'string' ||
      typeof jobSlug !== 'string'
    ) {
      return null;
    }
    return {
      workflowDefinitionId,
      workflowRunId,
      workflowRunStepId,
      jobRunId,
      jobSlug
    } satisfies WorkflowEventContext;
  } catch {
    return null;
  }
}
