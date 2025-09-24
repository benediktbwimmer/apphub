import type { WorkflowCreateInput } from '../../workflows/api';
import type { ExampleJobBundleSlug } from '../../../../../shared/exampleJobBundles';

export type ExampleScenarioType = 'service-manifest' | 'app' | 'job' | 'workflow' | 'scenario';

export type ExampleScenarioAsset = {
  label: string;
  description?: string;
  path?: string;
  href?: string;
};

type ExampleScenarioBase<T extends ExampleScenarioType> = {
  id: string;
  type: T;
  title: string;
  summary: string;
  description: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  tags?: string[];
  docs?: ExampleScenarioAsset[];
  assets?: ExampleScenarioAsset[];
  analyticsTag?: string;
};

export type ServiceManifestScenario = ExampleScenarioBase<'service-manifest'> & {
  form: {
    repo: string;
    ref?: string;
    commit?: string;
    configPath?: string;
    module?: string;
    variables?: Record<string, string>;
  };
};

export type AppScenario = ExampleScenarioBase<'app'> & {
  form: {
    id?: string;
    name: string;
    description: string;
    repoUrl: string;
    dockerfilePath: string;
    tags?: { key: string; value: string }[];
    sourceType?: 'remote' | 'local';
  };
};

export type JobScenario = ExampleScenarioBase<'job'> & {
  form: {
    source: 'upload' | 'registry';
    reference?: string;
    notes?: string;
  };
  bundle?: {
    filename: string;
    publicPath: string;
    contentType?: string;
  };
  exampleSlug?: ExampleJobBundleSlug;
};

export type WorkflowScenario = ExampleScenarioBase<'workflow'> & {
  form: WorkflowCreateInput;
  includes?: string[];
};

export type ScenarioBundle = ExampleScenarioBase<'scenario'> & {
  includes: string[];
  focus?: 'service-manifests' | 'apps' | 'jobs' | 'workflows';
};

export type ExampleScenario = ServiceManifestScenario | AppScenario | JobScenario | WorkflowScenario | ScenarioBundle;

export function isScenarioType<T extends ExampleScenarioType>(scenario: ExampleScenario, type: T): scenario is Extract<ExampleScenario, { type: T }> {
  return scenario.type === type;
}

export function groupScenariosByType(scenarios: ExampleScenario[]) {
  return scenarios.reduce<{
    'service-manifest': ServiceManifestScenario[];
    app: AppScenario[];
    job: JobScenario[];
    workflow: WorkflowScenario[];
    scenario: ScenarioBundle[];
  }>(
    (acc, scenario) => {
      switch (scenario.type) {
        case 'service-manifest':
          acc['service-manifest'].push(scenario);
          break;
        case 'app':
          acc.app.push(scenario);
          break;
        case 'job':
          acc.job.push(scenario);
          break;
        case 'workflow':
          acc.workflow.push(scenario);
          break;
        case 'scenario':
          acc.scenario.push(scenario);
          break;
        default:
          break;
      }
      return acc;
    },
    { 'service-manifest': [], app: [], job: [], workflow: [], scenario: [] }
  );
}
