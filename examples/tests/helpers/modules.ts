import type {
  ModuleCatalogData,
  ModuleJobBundle,
  ModuleWorkflow,
  ModuleWorkflowSlug
} from '@apphub/module-registry';
import { getModuleWorkflow, loadModuleCatalog } from '@apphub/module-registry';
import type { WorkflowDefinitionCreateInput } from '../../../services/core/src/workflows/zodSchemas';
import type { WorkflowDefinitionTemplate } from '@apphub/module-registry';

type ModuleCatalogCache = {
  catalog: ModuleCatalogData;
  timestamp: number;
};

let catalogCache: ModuleCatalogCache | null = null;

async function ensureCatalog(): Promise<ModuleCatalogData> {
  const ttlMs = 15_000;
  const now = Date.now();
  if (catalogCache && now - catalogCache.timestamp < ttlMs) {
    return catalogCache.catalog;
  }
  const catalog = await loadModuleCatalog();
  catalogCache = {
    catalog,
    timestamp: now
  } satisfies ModuleCatalogCache;
  return catalog;
}

export async function listObservatoryJobBundles(): Promise<ModuleJobBundle[]> {
  const catalog = await ensureCatalog();
  return catalog.jobs.filter((job) => job.moduleId === 'environmental-observatory');
}

export async function listObservatoryWorkflows(): Promise<ModuleWorkflow[]> {
  const catalog = await ensureCatalog();
  return catalog.workflows.filter((workflow) => workflow.moduleId === 'environmental-observatory');
}

export async function loadModuleWorkflowDefinition(
  slug: ModuleWorkflowSlug
): Promise<WorkflowDefinitionTemplate> {
  const workflow = await getModuleWorkflow(slug);
  if (!workflow) {
    throw new Error(`Unknown module workflow: ${slug}`);
  }
  return JSON.parse(JSON.stringify(workflow.definition)) as WorkflowDefinitionTemplate;
}

type ModuleWorkflowDefinition = WorkflowDefinitionCreateInput;

export async function listModuleWorkflowDefinitions(
  slugs: ModuleWorkflowSlug[]
): Promise<ModuleWorkflowDefinition[]> {
  const definitions: ModuleWorkflowDefinition[] = [];
  for (const slug of slugs) {
    const workflow = await loadModuleWorkflowDefinition(slug);
    definitions.push(JSON.parse(JSON.stringify(workflow)) as ModuleWorkflowDefinition);
  }
  return definitions;
}
