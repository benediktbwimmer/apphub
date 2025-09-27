import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ExampleJobBundle, ExampleWorkflow } from '@apphub/examples';
import type {
  JobDefinitionCreateInput,
  WorkflowDefinitionCreateInput
} from '../../src/workflows/zodSchemas';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jobsCatalogPath = path.join(repoRoot, 'examples', 'catalog', 'jobs.json');
const workflowsCatalogPath = path.join(repoRoot, 'examples', 'catalog', 'workflows.json');

const jobCatalog = JSON.parse(readFileSync(jobsCatalogPath, 'utf8')) as { bundles: ExampleJobBundle[] };
const workflowCatalog = JSON.parse(readFileSync(workflowsCatalogPath, 'utf8')) as {
  workflows: ExampleWorkflow[];
};

const JOB_MAP = new Map(jobCatalog.bundles.map((bundle) => [bundle.slug, bundle]));
const WORKFLOW_MAP = new Map(workflowCatalog.workflows.map((workflow) => [workflow.slug, workflow]));

const JOB_SLUGS = jobCatalog.bundles.map((bundle) => bundle.slug);
const WORKFLOW_SLUGS = workflowCatalog.workflows.map((workflow) => workflow.slug);

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
