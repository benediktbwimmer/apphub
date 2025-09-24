import {
  EXAMPLE_JOB_SLUGS,
  EXAMPLE_WORKFLOW_SLUGS,
  getExampleJobBundle,
  getExampleWorkflow,
  isExampleJobSlug,
  isExampleWorkflowSlug
} from '@apphub/examples-registry';
import type {
  JobDefinitionCreateInput,
  WorkflowDefinitionCreateInput
} from '../../src/workflows/zodSchemas';

const jobCache = new Map<string, JobDefinitionCreateInput>();
const workflowCache = new Map<string, WorkflowDefinitionCreateInput>();

function cloneJobDefinition(definition: unknown): JobDefinitionCreateInput {
  return JSON.parse(JSON.stringify(definition)) as JobDefinitionCreateInput;
}

function cloneWorkflowDefinition(definition: unknown): WorkflowDefinitionCreateInput {
  return JSON.parse(JSON.stringify(definition)) as WorkflowDefinitionCreateInput;
}

export function loadExampleJobDefinition(slug: string): JobDefinitionCreateInput {
  const normalized = slug.trim().toLowerCase();
  const cached = jobCache.get(normalized);
  if (cached) {
    return cloneJobDefinition(cached);
  }
  if (!isExampleJobSlug(normalized)) {
    throw new Error(`Unknown example job definition: ${slug}`);
  }
  const bundle = getExampleJobBundle(normalized);
  if (!bundle) {
    throw new Error(`Unknown example job definition: ${slug}`);
  }
  const definition = cloneJobDefinition(bundle.definition);
  jobCache.set(normalized, definition);
  return cloneJobDefinition(definition);
}

export function loadExampleWorkflowDefinition(slug: string): WorkflowDefinitionCreateInput {
  const normalized = slug.trim().toLowerCase();
  const cached = workflowCache.get(normalized);
  if (cached) {
    return cloneWorkflowDefinition(cached);
  }
  if (!isExampleWorkflowSlug(normalized)) {
    throw new Error(`Unknown example workflow definition: ${slug}`);
  }
  const workflow = getExampleWorkflow(normalized);
  if (!workflow) {
    throw new Error(`Unknown example workflow definition: ${slug}`);
  }
  const definition = cloneWorkflowDefinition(workflow.definition);
  workflowCache.set(normalized, definition);
  return cloneWorkflowDefinition(definition);
}

export function listExampleJobDefinitions(): JobDefinitionCreateInput[] {
  return EXAMPLE_JOB_SLUGS.map((slug) => loadExampleJobDefinition(slug));
}

export function listExampleWorkflowDefinitions(slugs: string[]): WorkflowDefinitionCreateInput[] {
  return slugs.map((slug) => loadExampleWorkflowDefinition(slug));
}

export function listAllExampleWorkflowDefinitions(): WorkflowDefinitionCreateInput[] {
  return EXAMPLE_WORKFLOW_SLUGS.map((slug) => loadExampleWorkflowDefinition(slug));
}
