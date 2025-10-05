import {
  createWorkflow,
  createWorkflowTrigger,
  moduleSetting,
  type WorkflowDefinition
} from '@apphub/module-sdk';

import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';

const definition: WorkflowDefinition = {
  slug: 'observatory-calibration-import',
  name: 'Observatory Calibration Import',
  version: 2,
  description: 'Persist uploaded calibration files and enqueue downstream reprocessing plans.',
  parametersSchema: {
    type: 'object',
    properties: {
      calibrationPath: { type: 'string', minLength: 1 },
      calibrationNodeId: { type: 'number', minimum: 1 },
      checksum: { type: 'string' }
    },
    required: ['calibrationPath']
  },
  steps: [
    {
      id: 'import-calibration',
      name: 'Import calibration file',
      type: 'job',
      jobSlug: 'observatory-calibration-importer',
      parameters: {
        calibrationPath: '{{ parameters.calibrationPath }}',
        calibrationNodeId: '{{ parameters.calibrationNodeId }}',
        checksum: '{{ parameters.checksum }}'
      },
      storeResultAs: 'importResult'
    },
    {
      id: 'plan-reprocessing',
      name: 'Plan calibration reprocessing',
      type: 'job',
      jobSlug: 'observatory-calibration-planner',
      parameters: {
        calibrations: [
          {
            calibrationId: '{{ steps.import-calibration.result.calibrationId }}',
            instrumentId: '{{ steps.import-calibration.result.instrumentId }}',
            effectiveAt: '{{ steps.import-calibration.result.effectiveAt }}',
            metastoreVersion: '{{ steps.import-calibration.result.metastoreVersion }}'
          }
        ]
      }
    }
  ]
};

const triggers = [
  createWorkflowTrigger({
    name: 'Import calibrations on upload',
    description: 'Import a calibration whenever a file is uploaded under the calibrations prefix.',
    eventType: 'filestore.command.completed',
    eventSource: 'filestore.service',
    predicates: [
      { path: '$.payload.command', operator: 'equals', value: 'uploadFile' },
      { path: '$.payload.backendMountId', operator: 'equals', value: moduleSetting('filestore.backendId') },
      {
        path: '$.payload.path',
        operator: 'regex',
        value: '^{{ module.settings.filestore.calibrationsPrefix }}(?:/|$)'
      }
    ],
    parameterTemplate: {
      calibrationPath: '{{ event.payload.path }}',
      calibrationNodeId: '{{ event.payload.node.id }}',
      checksum: '{{ event.payload.node.checksum }}'
    },
    idempotencyKeyExpression:
      "observatory-calibration-{{ event.payload.node.id | default: event.payload.path | replace: '/', '_' }}"
  })
];

export const calibrationImportWorkflow = createWorkflow<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets
>({
  name: definition.slug,
  displayName: definition.name,
  description: definition.description,
  definition,
  triggers
});
