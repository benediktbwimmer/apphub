import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ModuleManifest,
  ModuleManifestTarget,
  ModuleManifestWorkflowDetails
} from '@apphub/module-sdk';
import { listModules } from './catalog';
import type {
  ModuleJobBundle,
  ModuleJobSlug,
  ModuleScenario,
  ModuleWorkflow,
  ModuleWorkflowSlug,
  WorkflowDefinitionTemplate
} from './types';

export type ModuleCatalogData = {
  jobs: ReadonlyArray<ModuleJobBundle>;
  workflows: ReadonlyArray<ModuleWorkflow>;
  scenarios: ReadonlyArray<ModuleScenario>;
};

type CoreCache = ModuleCatalogData & {
  repoRoot: string;
  jobMap: Map<ModuleJobSlug, ModuleJobBundle>;
  jobSlugSet: Set<ModuleJobSlug>;
  workflowMap: Map<ModuleWorkflowSlug, ModuleWorkflow>;
  workflowSlugSet: Set<ModuleWorkflowSlug>;
  scenarioMap: Map<string, ModuleScenario>;
};

export type LoadCoreOptions = {
  repoRoot?: string;
  reload?: boolean;
};

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const MODULE_MANIFEST_FILENAME = path.join('dist', 'module.json');
let cache: CoreCache | null = null;

function normalizeRepoRoot(repoRoot?: string): string {
  if (!repoRoot) {
    return DEFAULT_REPO_ROOT;
  }
  return path.resolve(repoRoot);
}

async function loadCore(options: LoadCoreOptions = {}): Promise<CoreCache> {
  const repoRoot = normalizeRepoRoot(options.repoRoot);

  if (!options.reload && cache && cache.repoRoot === repoRoot) {
    return cache;
  }

  const modules = listModules();
  const jobs: ModuleJobBundle[] = [];
  const workflows: ModuleWorkflow[] = [];

  const scenarios: ModuleScenario[] = [];

  for (const entry of modules) {
    const moduleDir = path.resolve(repoRoot, entry.workspacePath);
    const manifestPath = path.join(moduleDir, MODULE_MANIFEST_FILENAME);
    const manifest = await readManifest(manifestPath);
    if (!manifest) {
      continue;
    }

    const moduleId = manifest.metadata?.name?.trim() ?? entry.id;
    const moduleVersion = manifest.metadata?.version?.trim() ?? '0.0.0';
    const relativeManifestPath = path.relative(repoRoot, manifestPath) || manifestPath;
    const relativeModulePath = path.relative(repoRoot, moduleDir) || moduleDir;

    for (const target of manifest.targets ?? []) {
      if (!target?.name || !target?.kind) {
        continue;
      }
      if (target.kind === 'job') {
        const slugValue = target.name.trim().toLowerCase();
        if (!isModuleJobSlugValue(slugValue)) {
          continue;
        }
        const version = target.version?.trim() ?? moduleVersion;
        jobs.push({
          slug: slugValue,
          version,
          moduleId,
          moduleVersion,
          modulePath: relativeModulePath,
          manifestPath: relativeManifestPath,
          target: target as ModuleManifestTarget & { kind: 'job' }
        });
        continue;
      }
      if (target.kind === 'workflow') {
        const slugValue = target.name.trim().toLowerCase();
        if (!isModuleWorkflowSlugValue(slugValue)) {
          continue;
        }
        const definition = resolveWorkflowDefinition(target);
        if (!definition) {
          continue;
        }
        workflows.push({
          slug: slugValue,
          moduleId,
          moduleVersion,
          manifestPath: relativeManifestPath,
          definition,
          target: target as ModuleManifestTarget & {
            kind: 'workflow';
            workflow: ModuleManifestWorkflowDetails;
          }
        });
      }
    }
  }

  const jobMap = new Map<ModuleJobSlug, ModuleJobBundle>();
  const jobSlugSet = new Set<ModuleJobSlug>();
  for (const bundle of jobs) {
    jobMap.set(bundle.slug, bundle);
    jobSlugSet.add(bundle.slug);
  }

  const workflowMap = new Map<ModuleWorkflowSlug, ModuleWorkflow>();
  const workflowSlugSet = new Set<ModuleWorkflowSlug>();
  for (const workflow of workflows) {
    workflowMap.set(workflow.slug, workflow);
    workflowSlugSet.add(workflow.slug);
  }

  const scenarioMap = new Map<string, ModuleScenario>();
  for (const scenario of scenarios) {
    scenarioMap.set(scenario.id, scenario);
  }

  cache = {
    repoRoot,
    jobs,
    workflows,
    scenarios,
    jobMap,
    jobSlugSet,
    workflowMap,
    workflowSlugSet,
    scenarioMap
  };

  return cache;
}

export async function loadModuleCatalog(options?: LoadCoreOptions): Promise<ModuleCatalogData> {
  const core = await loadCore(options);
  return {
    jobs: core.jobs,
    workflows: core.workflows,
    scenarios: core.scenarios
  };
}

export async function listModuleJobBundles(options?: LoadCoreOptions): Promise<ModuleJobBundle[]> {
  const core = await loadCore(options);
  return [...core.jobs];
}

export async function listModuleWorkflows(options?: LoadCoreOptions): Promise<ModuleWorkflow[]> {
  const core = await loadCore(options);
  return [...core.workflows];
}

export async function listModuleScenarios(options?: LoadCoreOptions): Promise<ModuleScenario[]> {
  const core = await loadCore(options);
  return [...core.scenarios];
}

export async function getModuleJobBundle(
  slug: string,
  options?: LoadCoreOptions
): Promise<ModuleJobBundle | null> {
  const core = await loadCore(options);
  const normalized = slug.trim().toLowerCase() as ModuleJobSlug;
  return core.jobMap.get(normalized) ?? null;
}

export async function isModuleJobSlug(value: string, options?: LoadCoreOptions): Promise<boolean> {
  const core = await loadCore(options);
  return core.jobSlugSet.has(value.trim().toLowerCase() as ModuleJobSlug);
}

export async function getModuleWorkflow(
  slug: string,
  options?: LoadCoreOptions
): Promise<ModuleWorkflow | null> {
  const core = await loadCore(options);
  const normalized = slug.trim().toLowerCase() as ModuleWorkflowSlug;
  return core.workflowMap.get(normalized) ?? null;
}

export async function isModuleWorkflowSlug(
  value: string,
  options?: LoadCoreOptions
): Promise<boolean> {
  const core = await loadCore(options);
  return core.workflowSlugSet.has(value.trim().toLowerCase() as ModuleWorkflowSlug);
}

export async function getModuleScenario(
  id: string,
  options?: LoadCoreOptions
): Promise<ModuleScenario | null> {
  const core = await loadCore(options);
  return core.scenarioMap.get(id) ?? null;
}

export async function clearModuleCatalogCache(): Promise<void> {
  cache = null;
}

async function readManifest(manifestPath: string): Promise<ModuleManifest | null> {
  try {
    const payload = await fs.readFile(manifestPath, 'utf8');
    return JSON.parse(payload) as ModuleManifest;
  } catch {
    return null;
  }
}

function resolveWorkflowDefinition(
  target: ModuleManifestTarget | undefined
): WorkflowDefinitionTemplate | null {
  if (!target || target.kind !== 'workflow') {
    return null;
  }
  const definition = target.workflow?.definition;
  if (!definition || typeof definition !== 'object') {
    return null;
  }
  return definition as WorkflowDefinitionTemplate;
}

function isModuleJobSlugValue(value: string): value is ModuleJobSlug {
  switch (value) {
    case 'observatory-data-generator':
    case 'observatory-inbox-normalizer':
    case 'observatory-timestore-loader':
    case 'observatory-visualization-runner':
    case 'observatory-dashboard-aggregator':
    case 'observatory-report-publisher':
    case 'observatory-calibration-importer':
    case 'observatory-calibration-planner':
    case 'observatory-calibration-reprocessor':
      return true;
    default:
      return false;
  }
}

function isModuleWorkflowSlugValue(value: string): value is ModuleWorkflowSlug {
  switch (value) {
    case 'observatory-minute-data-generator':
    case 'observatory-minute-ingest':
    case 'observatory-daily-publication':
    case 'observatory-dashboard-aggregate':
    case 'observatory-calibration-import':
    case 'observatory-calibration-reprocess':
      return true;
    default:
      return false;
  }
}
