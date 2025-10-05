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
      storeResultAs: 'visualizations'
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
    name: 'Publish on observatory partition',
    description: 'Generate plots and publish reports when the ingest workflow marks a partition ready.',
    eventType: 'observatory.minute.partition-ready',
    eventSource: 'observatory.events',
    predicates: [
      {
        path: '$.payload.datasetSlug',
        operator: 'equals',
        value: moduleSetting('timestore.datasetSlug')
      }
    ],
    parameterTemplate: {
      partitionKey:
        "{{ event.payload.partitionKeyFields.window | default: event.payload.minute | default: event.payload.partitionKey }}",
      partitionWindow:
        "{{ event.payload.partitionKeyFields.window | default: event.payload.minute | default: event.payload.partitionKey | slice: 0, 16 }}",
      instrumentId: '{{ event.payload.instrumentId }}',
      lookbackMinutes: moduleSetting('dashboard.lookbackMinutes')
    },
    idempotencyKeyExpression:
      'observatory-publication-{{ event.payload.partitionKeyFields.window | default: event.payload.minute | default: event.payload.partitionKey }}'
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
