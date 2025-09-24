import { EXAMPLE_JOB_BUNDLES } from './jobs';
import { EXAMPLE_WORKFLOWS } from './workflows';

export type ExamplesCatalogIndex = {
  jobs: Record<string, string>;
  workflows: Record<string, string>;
};

export function buildExamplesCatalogIndex(): ExamplesCatalogIndex {
  return {
    jobs: EXAMPLE_JOB_BUNDLES.reduce<Record<string, string>>((acc, bundle) => {
      acc[bundle.slug] = bundle.jobDefinitionPath;
      return acc;
    }, {}),
    workflows: EXAMPLE_WORKFLOWS.reduce<Record<string, string>>((acc, workflow) => {
      acc[workflow.slug] = workflow.path;
      return acc;
    }, {})
  };
}
