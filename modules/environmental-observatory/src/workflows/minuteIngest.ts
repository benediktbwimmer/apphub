import {
  createWorkflow,
  createWorkflowTrigger,
  moduleSetting,
  type WorkflowDefinition
} from '@apphub/module-sdk';

import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';

const definition: WorkflowDefinition = {
  slug: 'observatory-minute-ingest',
  name: 'Observatory Minute Ingest',
  version: 2,
  description: 'Normalize observatory inbox drops and persist minute partitions into Timestore.',
  parametersSchema: {
    type: 'object',
    properties: {
      minute: { type: 'string', minLength: 1 },
      maxFiles: { type: 'number', minimum: 1, maximum: 200 },
      commandPath: { type: 'string', minLength: 1 }
    },
    required: []
  },
  defaultParameters: {
    maxFiles: moduleSetting('ingest.maxFiles')
  },
  steps: [
    {
      id: 'normalize-inbox',
      name: 'Normalize inbox files',
      type: 'job',
      jobSlug: 'observatory-minute-preprocessor',
      parameters: {
        minute: '{{ parameters.minute | default: run.trigger.schedule.occurrence | slice: 0, 16 }}',
        maxFiles: '{{ parameters.maxFiles | default: defaultParameters.maxFiles }}',
        commandPath: '{{ parameters.commandPath }}'
      },
      storeResultAs: 'normalized',
      produces: [
        {
          assetId: 'observatory.inbox.normalized',
          partitioning: {
            type: 'timeWindow',
            granularity: 'minute',
            format: 'YYYY-MM-DDTHH:mm',
            lookbackWindows: 1440
          }
        }
      ]
    },
    {
      id: 'load-timestore',
      name: 'Load timestore partition',
      type: 'job',
      jobSlug: 'observatory-timestore-loader',
      dependsOn: ['normalize-inbox'],
      parameters: {
        minute: '{{ steps.normalize-inbox.result.minute | default: parameters.minute | default: run.trigger.schedule.occurrence | slice: 0, 16 }}',
        rawAsset: '{{ steps.normalize-inbox.result }}',
        idempotencyKey: '{{ parameters.commandPath | default: parameters.minute }}'
      },
      consumes: [
        {
          assetId: 'observatory.inbox.normalized'
        }
      ],
      produces: [
        {
          assetId: 'observatory.timeseries.timestore',
          partitioning: {
            type: 'timeWindow',
            granularity: 'minute',
            format: 'YYYY-MM-DDTHH:mm',
            lookbackWindows: 1440
          },
          autoMaterialize: {
            enabled: false
          }
        },
        {
          assetId: 'observatory.burst.window',
          partitioning: {
            type: 'timeWindow',
            granularity: 'minute',
            format: 'YYYY-MM-DDTHH:mm',
            lookbackWindows: 1440
          },
          freshness: {
            ttlMs: 5000
          },
          autoMaterialize: {
            enabled: false
          }
        }
      ]
    }
  ]
};

const triggers = [
  createWorkflowTrigger({
    name: 'Observatory ingest on filestore upload',
    description: 'Kick off the ingest workflow whenever a normalized observatory CSV arrives.',
    eventType: 'filestore.command.completed',
    eventSource: 'filestore.service',
    predicates: [
      { path: '$.payload.command', operator: 'equals', value: 'uploadFile' },
      { path: '$.payload.backendMountId', operator: 'equals', value: moduleSetting('filestore.backendId') },
      { path: '$.payload.node.metadata.minute', operator: 'exists' }
    ],
    parameterTemplate: {
      minute: '{{ event.payload.node.metadata.minute }}',
      commandPath: '{{ event.payload.path }}',
      maxFiles: '{{ trigger.metadata.maxFiles }}'
    },
    metadata: {
      maxFiles: moduleSetting('ingest.maxFiles')
    },
    runKeyTemplate:
      "observatory-ingest-{{ event.payload.node.metadata.instrumentId | default: 'unknown' | replace: ':', '-' }}-{{ event.payload.node.metadata.minute | replace: ':', '-' }}",
    idempotencyKeyExpression:
      "{{ event.payload.node.metadata.minute }}-{{ event.payload.path | replace: '/', '_' | replace: ':', '-' }}"
  })
];

export const minuteIngestWorkflow = createWorkflow<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets
>({
  name: definition.slug,
  displayName: definition.name,
  description: definition.description,
  definition,
  triggers
});
