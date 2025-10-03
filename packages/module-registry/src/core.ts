import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  discoverLocalDescriptorConfigs,
  readBundleSlugFromConfig,
  readModuleDescriptor,
  resolveBundleManifests
} from './descriptors/loader';
import type {
  ModuleJobBundle,
  ModuleJobSlug,
  ModuleScenario,
  ModuleWorkflow,
  ModuleWorkflowSlug
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
const JOBS_FILENAME = path.join('examples', 'core', 'jobs.json');
const WORKFLOWS_FILENAME = path.join('examples', 'core', 'workflows.json');
const SCENARIOS_FILENAME = path.join('examples', 'core', 'scenarios.json');

let cache: CoreCache | null = null;

async function readJsonFile<T>(repoRoot: string, relativePath: string): Promise<T> {
  const absolutePath = path.resolve(repoRoot, relativePath);
  const payload = await fs.readFile(absolutePath, 'utf8');
  return JSON.parse(payload) as T;
}

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

  type JobFile = { bundles: ModuleJobBundle[] };
  type WorkflowFile = { workflows: ModuleWorkflow[] };
  type ScenarioFile = { scenarios: ModuleScenario[] };

  const [jobsFile, workflowsFile, scenariosFile] = await Promise.all([
    readJsonFile<JobFile>(repoRoot, JOBS_FILENAME),
    readJsonFile<WorkflowFile>(repoRoot, WORKFLOWS_FILENAME),
    readJsonFile<ScenarioFile>(repoRoot, SCENARIOS_FILENAME)
  ]);

  const descriptorIndex = await buildDescriptorIndex(repoRoot);

  const jobs = (jobsFile.bundles ?? []).map((bundle) => {
    const descriptor = descriptorIndex.get(bundle.slug.toLowerCase());
    return descriptor
      ? {
          ...bundle,
          descriptor
        }
      : bundle;
  });
  const workflows = workflowsFile.workflows ?? [];
  const scenarios = scenariosFile.scenarios ?? [];

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

async function buildDescriptorIndex(
  repoRoot: string
): Promise<Map<string, { module: string; configPath: string }>> {
  const configPaths = await discoverLocalDescriptorConfigs(repoRoot);
  const index = new Map<string, { module: string; configPath: string }>();

  for (const configPath of configPaths) {
    try {
      const descriptorFile = await readModuleDescriptor(configPath);
      const bundleManifests = resolveBundleManifests(descriptorFile);
      for (const manifest of bundleManifests) {
        const normalizedPath = manifest.path.trim().toLowerCase();
        if (!normalizedPath.endsWith('apphub.bundle.json')) {
          continue;
        }
        const slug = await readBundleSlugFromConfig(manifest.absolutePath);
        if (!slug) {
          continue;
        }
        const normalizedSlug = slug.trim().toLowerCase();
        if (normalizedSlug.length === 0 || index.has(normalizedSlug)) {
          continue;
        }
        const relativeConfig = path.relative(repoRoot, descriptorFile.configPath) || descriptorFile.configPath;
        index.set(normalizedSlug, {
          module: descriptorFile.descriptor.module,
          configPath: relativeConfig
        });
      }
    } catch {
      // Ignore descriptors that fail to parse; they may represent remote-only sources.
    }
  }

  return index;
}
