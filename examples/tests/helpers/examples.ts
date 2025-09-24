import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { JobDefinitionCreateInput, WorkflowDefinitionCreateInput } from '../../src/workflows/zodSchemas';

const repoRoot = path.resolve(__dirname, '../../..');
const indexPath = path.join(repoRoot, 'examples', 'catalog-index.json');

type ExamplesCatalogIndex = {
  jobs: Record<string, string>;
  workflows?: Record<string, string>;
};

const catalogIndex = JSON.parse(readFileSync(indexPath, 'utf8')) as ExamplesCatalogIndex;

const jobCache = new Map<string, JobDefinitionCreateInput>();
const workflowCache = new Map<string, WorkflowDefinitionCreateInput>();

export function loadExampleJobDefinition(slug: string): JobDefinitionCreateInput {
  const normalized = slug.trim().toLowerCase();
  const cached = jobCache.get(normalized);
  if (cached) {
    return JSON.parse(JSON.stringify(cached)) as JobDefinitionCreateInput;
  }
  const relativePath = catalogIndex.jobs[normalized];
  if (!relativePath) {
    throw new Error(`Unknown example job definition: ${slug}`);
  }
  const absolutePath = path.join(repoRoot, relativePath);
  const definition = JSON.parse(readFileSync(absolutePath, 'utf8')) as JobDefinitionCreateInput;
  jobCache.set(normalized, definition);
  return JSON.parse(JSON.stringify(definition)) as JobDefinitionCreateInput;
}

export function loadExampleWorkflowDefinition(slug: string): WorkflowDefinitionCreateInput {
  const normalized = slug.trim().toLowerCase();
  const cached = workflowCache.get(normalized);
  if (cached) {
    return JSON.parse(JSON.stringify(cached)) as WorkflowDefinitionCreateInput;
  }
  const relativePath = catalogIndex.workflows?.[normalized];
  if (!relativePath) {
    throw new Error(`Unknown example workflow definition: ${slug}`);
  }
  const absolutePath = path.join(repoRoot, relativePath);
  const definition = JSON.parse(readFileSync(absolutePath, 'utf8')) as WorkflowDefinitionCreateInput;
  workflowCache.set(normalized, definition);
  return JSON.parse(JSON.stringify(definition)) as WorkflowDefinitionCreateInput;
}

export function listExampleJobDefinitions(): JobDefinitionCreateInput[] {
  return Object.keys(catalogIndex.jobs).map((slug) => loadExampleJobDefinition(slug));
}

export function listExampleWorkflowDefinitions(slugs: string[]): WorkflowDefinitionCreateInput[] {
  return slugs.map((slug) => loadExampleWorkflowDefinition(slug));
}
