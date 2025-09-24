export type ExampleScenarioType = 'service-manifest' | 'app' | 'job';

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
};

export type ExampleScenario = ServiceManifestScenario | AppScenario | JobScenario;

export function isScenarioType<T extends ExampleScenarioType>(scenario: ExampleScenario, type: T): scenario is Extract<ExampleScenario, { type: T }> {
  return scenario.type === type;
}

export function groupScenariosByType(scenarios: ExampleScenario[]) {
  return scenarios.reduce<{
    'service-manifest': ServiceManifestScenario[];
    app: AppScenario[];
    job: JobScenario[];
  }>(
    (acc, scenario) => {
      if (scenario.type === 'service-manifest') {
        acc['service-manifest'].push(scenario);
      } else if (scenario.type === 'app') {
        acc.app.push(scenario);
      } else {
        acc.job.push(scenario);
      }
      return acc;
    },
    { 'service-manifest': [], app: [], job: [] }
  );
}
