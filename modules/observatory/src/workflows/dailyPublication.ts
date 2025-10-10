import {
  createWorkflow,
  createWorkflowTrigger,
  moduleSetting,
  type WorkflowDefinition
} from '@apphub/module-sdk';

import type { ObservatorySecrets, ObservatorySettings } from '../config/settings';

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
        partitionWindow: '{{ parameters.partitionWindow | default: parameters.partitionKey }}',
        instrumentId: '{{ parameters.instrumentId | default: "" }}',
        siteFilter: '{{ parameters.siteFilter | default: "" }}',
        lookbackMinutes: '{{ parameters.lookbackMinutes | default: 720 }}'
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
      dependsOn: ['generate-plots'],
      parameters: {
        partitionKey: '{{ parameters.partitionKey }}',
        instrumentId: '{{ parameters.instrumentId | default: "" }}',
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
    eventType: 'asset.produced',
    eventSource: 'core.asset-materializer',
    predicates: [
      {
        path: '$.payload.assetId',
        operator: 'equals',
        value: 'observatory.timeseries.timestore'
      }
    ],
    parameterTemplate: {
      partitionKey: '{{ event.payload.partitionKey | default: "" }}',
      partitionWindow: '{{ event.payload.payload.partitionKeyFields.window | default: event.payload.partitionKey | default: "" }}',
      instrumentId: '{{ event.payload.payload.partitionKeyFields.instrument | default: "" }}',
      lookbackMinutes: 720
    },
    metadata: {
      lookbackMinutes: moduleSetting('dashboard.lookbackMinutes'),
      workflowSlug: 'observatory-minute-ingest',
      assetId: 'observatory.timeseries.timestore'
    },
    idempotencyKeyExpression:
      'observatory-publication-{{ event.payload.partitionKey }}'
  })
];

export const dailyPublicationWorkflow = createWorkflow<
  ObservatorySettings,
  ObservatorySecrets
>({
  name: definition.slug,
  displayName: definition.name,
  description: definition.description,
  definition,
  triggers
});
