import type {
  ModuleScenarioType as ExampleScenarioType,
  ModuleScenarioAsset as ExampleScenarioAsset,
  ModuleScenario as ExampleScenario,
  ServiceManifestScenario,
  AppScenario,
  JobScenario,
  WorkflowScenario,
  ScenarioBundle
} from '@apphub/module-registry/dist/types';

export type {
  ExampleScenarioType,
  ExampleScenarioAsset,
  ExampleScenario,
  ServiceManifestScenario,
  AppScenario,
  JobScenario,
  WorkflowScenario,
  ScenarioBundle
};

export function isScenarioType<T extends ExampleScenarioType>(
  scenario: ExampleScenario,
  type: T
): scenario is Extract<ExampleScenario, { type: T }> {
  return scenario.type === type;
}

export function groupScenariosByType(scenarios: ExampleScenario[]): {
  'service-manifest': ServiceManifestScenario[];
  app: AppScenario[];
  job: JobScenario[];
  workflow: WorkflowScenario[];
  scenario: ScenarioBundle[];
} {
  return scenarios.reduce(
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
    {
      'service-manifest': [] as ServiceManifestScenario[],
      app: [] as AppScenario[],
      job: [] as JobScenario[],
      workflow: [] as WorkflowScenario[],
      scenario: [] as ScenarioBundle[]
    }
  );
}
