import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  discoverLocalDescriptorConfigs,
  readBundleSlugFromConfig,
  readExampleDescriptor,
  resolveBundleManifests
} from './descriptors/loader';
import type {
  ExampleJobBundle,
  ExampleJobSlug,
  ExampleScenario,
  ExampleWorkflow,
  ExampleWorkflowSlug
} from './types';

export type ExampleCoreData = {
  jobs: ReadonlyArray<ExampleJobBundle>;
  workflows: ReadonlyArray<ExampleWorkflow>;
  scenarios: ReadonlyArray<ExampleScenario>;
};

type CoreCache = ExampleCoreData & {
  repoRoot: string;
  jobMap: Map<ExampleJobSlug, ExampleJobBundle>;
  jobSlugSet: Set<ExampleJobSlug>;
  workflowMap: Map<ExampleWorkflowSlug, ExampleWorkflow>;
  workflowSlugSet: Set<ExampleWorkflowSlug>;
  scenarioMap: Map<string, ExampleScenario>;
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

  type JobFile = { bundles: ExampleJobBundle[] };
  type WorkflowFile = { workflows: ExampleWorkflow[] };
  type ScenarioFile = { scenarios: ExampleScenario[] };

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

  const jobMap = new Map<ExampleJobSlug, ExampleJobBundle>();
  const jobSlugSet = new Set<ExampleJobSlug>();
  for (const bundle of jobs) {
    jobMap.set(bundle.slug, bundle);
    jobSlugSet.add(bundle.slug);
  }

  const workflowMap = new Map<ExampleWorkflowSlug, ExampleWorkflow>();
  const workflowSlugSet = new Set<ExampleWorkflowSlug>();
  for (const workflow of workflows) {
    workflowMap.set(workflow.slug, workflow);
    workflowSlugSet.add(workflow.slug);
  }

  const scenarioMap = new Map<string, ExampleScenario>();
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

export async function loadExampleCore(options?: LoadCoreOptions): Promise<ExampleCoreData> {
  const core = await loadCore(options);
  return {
    jobs: core.jobs,
    workflows: core.workflows,
    scenarios: core.scenarios
  };
}

export async function listExampleJobBundles(options?: LoadCoreOptions): Promise<ExampleJobBundle[]> {
  const core = await loadCore(options);
  return [...core.jobs];
}

export async function listExampleWorkflows(options?: LoadCoreOptions): Promise<ExampleWorkflow[]> {
  const core = await loadCore(options);
  return [...core.workflows];
}

export async function listExampleScenarios(options?: LoadCoreOptions): Promise<ExampleScenario[]> {
  const core = await loadCore(options);
  return [...core.scenarios];
}

export async function getExampleJobBundle(
  slug: string,
  options?: LoadCoreOptions
): Promise<ExampleJobBundle | null> {
  const core = await loadCore(options);
  const normalized = slug.trim().toLowerCase() as ExampleJobSlug;
  return core.jobMap.get(normalized) ?? null;
}

export async function isExampleJobSlug(value: string, options?: LoadCoreOptions): Promise<boolean> {
  const core = await loadCore(options);
  return core.jobSlugSet.has(value.trim().toLowerCase() as ExampleJobSlug);
}

export async function getExampleWorkflow(
  slug: string,
  options?: LoadCoreOptions
): Promise<ExampleWorkflow | null> {
  const core = await loadCore(options);
  const normalized = slug.trim().toLowerCase() as ExampleWorkflowSlug;
  return core.workflowMap.get(normalized) ?? null;
}

export async function isExampleWorkflowSlug(
  value: string,
  options?: LoadCoreOptions
): Promise<boolean> {
  const core = await loadCore(options);
  return core.workflowSlugSet.has(value.trim().toLowerCase() as ExampleWorkflowSlug);
}

export async function getExampleScenario(
  id: string,
  options?: LoadCoreOptions
): Promise<ExampleScenario | null> {
  const core = await loadCore(options);
  return core.scenarioMap.get(id) ?? null;
}

export async function clearExampleCoreCache(): Promise<void> {
  cache = null;
}

async function buildDescriptorIndex(
  repoRoot: string
): Promise<Map<string, { module: string; configPath: string }>> {
  const configPaths = await discoverLocalDescriptorConfigs(repoRoot);
  const index = new Map<string, { module: string; configPath: string }>();

  for (const configPath of configPaths) {
    try {
      const descriptorFile = await readExampleDescriptor(configPath);
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
