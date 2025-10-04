import { createWorkflow, moduleSetting, type WorkflowDefinition } from '@apphub/module-sdk';

import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';

const definition: WorkflowDefinition = {
  slug: 'observatory-calibration-reprocess',
  name: 'Observatory Calibration Reprocess',
  version: 2,
  description: 'Execute calibration reprocessing plans and persist progress back to the plan artifact.',
  parametersSchema: {
    type: 'object',
    properties: {
      planPath: { type: 'string' },
      planNodeId: { type: 'number', minimum: 1 },
      planId: { type: 'string' },
      mode: { type: 'string', enum: ['all', 'selected'] },
      selectedPartitions: {
        type: 'array',
        items: { type: 'string', minLength: 1 }
      },
      pollIntervalMs: { type: 'number', minimum: 250, maximum: 10_000 }
    },
    required: []
  },
  defaultParameters: {
    mode: 'all',
    selectedPartitions: [],
    pollIntervalMs: moduleSetting('reprocess.pollIntervalMs')
  },
  steps: [
    {
      id: 'orchestrate-reprocess',
      name: 'Orchestrate calibration reprocess',
      type: 'job',
      jobSlug: 'observatory-calibration-reprocessor',
      parameters: {
        planPath: '{{ parameters.planPath }}',
        planNodeId: '{{ parameters.planNodeId }}',
        planId: '{{ parameters.planId }}',
        mode: '{{ parameters.mode | default: defaultParameters.mode }}',
        selectedPartitions: '{{ parameters.selectedPartitions | default: defaultParameters.selectedPartitions }}',
        pollIntervalMs: '{{ parameters.pollIntervalMs | default: defaultParameters.pollIntervalMs }}'
      }
    }
  ]
};

export const calibrationReprocessWorkflow = createWorkflow<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets
>({
  name: definition.slug,
  displayName: definition.name,
  description: definition.description,
  definition
});
