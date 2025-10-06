import { createWorkflow, createWorkflowTrigger, moduleSetting, type WorkflowDefinition } from '@apphub/module-sdk';

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

const triggers = [
  createWorkflowTrigger({
    name: 'Reprocess on plan materialization',
    description: 'Execute calibration reprocess automatically when a plan asset updates.',
    eventType: 'asset.produced',
    eventSource: 'core.asset-materializer',
    predicates: [
      {
        path: '$.payload.assetId',
        operator: 'equals',
        value: 'observatory.reprocess.plan'
      }
    ],
    parameterTemplate: {
      planId: '{{ event.payload.partitionKey }}',
      pollIntervalMs: '{{ trigger.metadata.pollIntervalMs }}'
    },
    metadata: {
      pollIntervalMs: moduleSetting('reprocess.pollIntervalMs')
    },
    idempotencyKeyExpression: 'observatory-reprocess-{{ event.payload.partitionKey }}'
  })
];

export const calibrationReprocessWorkflow = createWorkflow<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets
>({
  name: definition.slug,
  displayName: definition.name,
  description: definition.description,
  definition,
  triggers
});
