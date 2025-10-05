import {
  createWorkflow,
  createWorkflowTrigger,
  moduleSetting,
  type WorkflowDefinition
} from '@apphub/module-sdk';

import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';

const definition: WorkflowDefinition = {
  slug: 'observatory-daily-publication',
  name: 'Observatory Visualization & Reports',
  version: 2,
  description: 'Generate visualization artifacts and publish observatory status reports.',
  parametersSchema: {
    type: 'object',
    properties: {
      partitionKey: { type: 'string', minLength: 1 },
      partitionWindow: { type: 'string' },
      instrumentId: { type: 'string' },
      lookbackMinutes: { type: 'number', minimum: 1, maximum: 10_080 },
      siteFilter: { type: 'string' },
      reportTemplate: { type: 'string' }
    },
    required: ['partitionKey']
  },
  defaultParameters: {
    lookbackMinutes: moduleSetting('dashboard.lookbackMinutes')
  },
  steps: [
    {
      id: 'generate-plots',
      name: 'Generate observatory visualizations',
      type: 'job',
      jobSlug: 'observatory-visualization-runner',
      parameters: {
        partitionKey: '{{ parameters.partitionKey }}',
        partitionWindow: '{{ parameters.partitionWindow | default: parameters.partitionKey | slice: 0, 16 }}',
        instrumentId: '{{ parameters.instrumentId }}',
        siteFilter: '{{ parameters.siteFilter | default: "" }}',
        lookbackMinutes: '{{ parameters.lookbackMinutes | default: defaultParameters.lookbackMinutes }}'
      },
      storeResultAs: 'visualizations',
      produces: [
        {
          assetId: 'observatory.visualizations.minute',
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
      id: 'publish-reports',
      name: 'Publish observatory reports',
      type: 'job',
      jobSlug: 'observatory-report-publisher',
      parameters: {
        partitionKey: '{{ parameters.partitionKey }}',
        instrumentId: '{{ parameters.instrumentId }}',
        reportTemplate: '{{ parameters.reportTemplate | default: "" }}',
        visualizationAsset: '{{ steps.generate-plots.result.visualization }}'
      },
      consumes: [
        {
          assetId: 'observatory.timeseries.timestore'
        }
      ],
      produces: [
        {
          assetId: 'observatory.reports.status',
          partitioning: {
            type: 'timeWindow',
            granularity: 'minute',
            format: 'YYYY-MM-DDTHH:mm',
            lookbackWindows: 1440
          }
        }
      ]
    }
  ]
};

const triggers = [
  createWorkflowTrigger({
    name: 'Publish on timestore asset',
    description: 'Generate plots when a timestore asset materializes.',
    eventType: 'observatory.asset.materialized',
    eventSource: 'observatory.events',
    predicates: [
      {
        path: '$.payload.assetId',
        operator: 'equals',
        value: 'observatory.timeseries.timestore'
      }
    ],
    parameterTemplate: {
      partitionKey: '{{ event.payload.partitionKey }}',
      partitionWindow:
        "{{ event.payload.metadata.partitionKeyFields.window | default: event.payload.metadata.minute | default: event.payload.partitionKey | slice: 0, 16 }}",
      instrumentId: '{{ event.payload.metadata.instrumentId }}',
      lookbackMinutes: moduleSetting('dashboard.lookbackMinutes')
    },
    metadata: {
      lookbackMinutes: moduleSetting('dashboard.lookbackMinutes')
    },
    idempotencyKeyExpression:
      'observatory-publication-{{ event.payload.partitionKey }}'
  })
];

export const dailyPublicationWorkflow = createWorkflow<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets
>({
  name: definition.slug,
  displayName: definition.name,
  description: definition.description,
  definition,
  triggers
});
