import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ExampleJobBundle, ExampleWorkflow } from '@apphub/examples';
import type {
  JobDefinitionCreateInput,
  WorkflowDefinitionCreateInput
} from '../../src/workflows/zodSchemas';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jobsCorePath = path.join(repoRoot, 'examples', 'core', 'jobs.json');
const workflowsCorePath = path.join(repoRoot, 'examples', 'core', 'workflows.json');

const jobCore = JSON.parse(readFileSync(jobsCorePath, 'utf8')) as { bundles: ExampleJobBundle[] };
const workflowCore = JSON.parse(readFileSync(workflowsCorePath, 'utf8')) as {
  workflows: ExampleWorkflow[];
};

const JOB_MAP = new Map(jobCore.bundles.map((bundle) => [bundle.slug, bundle]));
const WORKFLOW_MAP = new Map(workflowCore.workflows.map((workflow) => [workflow.slug, workflow]));

const JOB_SLUGS = jobCore.bundles.map((bundle) => bundle.slug);
const WORKFLOW_SLUGS = workflowCore.workflows.map((workflow) => workflow.slug);

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
  const bundle = JOB_MAP.get(normalized);
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
  const workflow = WORKFLOW_MAP.get(normalized);
  if (!workflow) {
    throw new Error(`Unknown example workflow definition: ${slug}`);
  }
  const definition = cloneWorkflowDefinition(workflow.definition);
  workflowCache.set(normalized, definition);
  return cloneWorkflowDefinition(definition);
}

export function listExampleJobDefinitions(): JobDefinitionCreateInput[] {
  return JOB_SLUGS.map((slug) => loadExampleJobDefinition(slug));
}

export function listExampleWorkflowDefinitions(slugs: string[]): WorkflowDefinitionCreateInput[] {
  return slugs.map((slug) => loadExampleWorkflowDefinition(slug));
}

export function listAllExampleWorkflowDefinitions(): WorkflowDefinitionCreateInput[] {
  return WORKFLOW_SLUGS.map((slug) => loadExampleWorkflowDefinition(slug));
}
