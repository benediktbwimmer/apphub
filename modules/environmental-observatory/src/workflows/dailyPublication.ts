import { createWorkflow, createWorkflowTrigger, type WorkflowDefinition } from '@apphub/module-sdk';

import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';

const definition: WorkflowDefinition = {
  slug: 'observatory-daily-publication',
  name: 'Observatory Visualization & Reports',
  version: 1,
  description:
    'Generates plots from Timestore partitions and publishes minute-level status reports with optional Metastore upserts.',
  parametersSchema: {
    type: 'object',
    properties: {
      timestoreBaseUrl: { type: 'string', minLength: 1 },
      timestoreDatasetSlug: { type: 'string', minLength: 1 },
      timestoreAuthToken: { type: 'string' },
      partitionKey: { type: 'string', minLength: 1 },
      instrumentId: { type: 'string' },
      lookbackMinutes: { type: 'number', minimum: 1, maximum: 10_080 },
      siteFilter: { type: 'string' },
      reportTemplate: { type: 'string' },
      metastoreBaseUrl: { type: 'string' },
      metastoreAuthToken: { type: 'string' },
      metastoreNamespace: { type: 'string' },
      visualizationsPrefix: { type: 'string', minLength: 1 },
      reportsPrefix: { type: 'string', minLength: 1 },
      filestoreBaseUrl: { type: 'string', minLength: 1 },
      filestoreBackendId: { type: ['integer', 'null'], minimum: 1 },
      filestoreToken: { type: 'string' },
      filestorePrincipal: { type: 'string' },
      filestoreBackendKey: { type: 'string', minLength: 1 }
    },
    required: [
      'timestoreBaseUrl',
      'timestoreDatasetSlug',
      'partitionKey',
      'instrumentId',
      'visualizationsPrefix',
      'reportsPrefix',
      'filestoreBaseUrl',
      'filestoreBackendKey'
    ]
  },
  defaultParameters: {
    lookbackMinutes: 180,
    timestoreBaseUrl: 'http://127.0.0.1:4200',
    timestoreDatasetSlug: 'observatory-timeseries',
    metastoreBaseUrl: 'http://127.0.0.1:4100',
    metastoreNamespace: 'observatory.reports',
    timestoreAuthToken: null,
    metastoreAuthToken: null,
    instrumentId: null,
    visualizationsPrefix: 'datasets/observatory/visualizations',
    reportsPrefix: 'datasets/observatory/reports',
    filestoreBaseUrl: 'http://127.0.0.1:4300',
    filestoreBackendId: 1,
    filestoreToken: null,
    filestorePrincipal: null,
    filestoreBackendKey: 'observatory-event-driven-s3'
  },
  steps: [
    {
      id: 'generate-plots',
      name: 'Generate observatory plots',
      type: 'job',
      jobSlug: 'observatory-visualization-runner',
      parameters: {
        timestoreBaseUrl: '{{ parameters.timestoreBaseUrl }}',
        timestoreDatasetSlug: '{{ parameters.timestoreDatasetSlug }}',
        timestoreAuthToken: '{{ parameters.timestoreAuthToken }}',
        partitionKey: '{{ parameters.partitionKey }}',
        instrumentId: '{{ parameters.instrumentId }}',
        lookbackMinutes: '{{ parameters.lookbackMinutes }}',
        siteFilter: '{{ parameters.siteFilter }}',
        filestoreBaseUrl: '{{ parameters.filestoreBaseUrl }}',
        filestoreBackendId: '{{ parameters.filestoreBackendId }}',
        filestoreToken: '{{ parameters.filestoreToken }}',
        filestorePrincipal: '{{ parameters.filestorePrincipal }}',
        visualizationsPrefix: '{{ parameters.visualizationsPrefix }}',
        filestoreBackendKey: '{{ parameters.filestoreBackendKey }}'
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
        lookbackMinutes: '{{ parameters.lookbackMinutes }}',
        reportTemplate: '{{ parameters.reportTemplate }}',
        summarySource: '{{ steps.generate-plots.result.summary }}',
        visualizationAsset: '{{ steps.generate-plots.result }}',
        metastoreBaseUrl: '{{ parameters.metastoreBaseUrl }}',
        metastoreNamespace: '{{ parameters.metastoreNamespace }}',
        metastoreAuthToken: '{{ parameters.metastoreAuthToken }}',
        filestoreBaseUrl: '{{ parameters.filestoreBaseUrl }}',
        filestoreBackendId: '{{ parameters.filestoreBackendId }}',
        filestoreToken: '{{ parameters.filestoreToken }}',
        filestorePrincipal: '{{ parameters.filestorePrincipal }}',
        visualizationsPrefix: '{{ parameters.visualizationsPrefix }}',
        reportsPrefix: '{{ parameters.reportsPrefix }}',
        filestoreBackendKey: '{{ parameters.filestoreBackendKey }}'
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
          },
          schema: {
            type: 'object',
            properties: {
              generatedAt: { type: 'string' },
              storagePrefix: { type: 'string' },
              reportFiles: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    nodeId: { type: 'number' },
                    mediaType: { type: 'string' },
                    sizeBytes: { type: 'number' },
                    checksum: { type: 'string' }
                  },
                  required: ['path', 'mediaType']
                }
              },
              summary: { type: 'object' },
              plotsReferenced: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    altText: { type: 'string' }
                  },
                  required: ['path']
                }
              },
              instrumentId: { type: 'string' }
            },
            required: ['generatedAt', 'storagePrefix', 'reportFiles']
          }
        }
      ]
    }
  ]
};

const triggers = [
  createWorkflowTrigger({
    name: 'Observatory publication on observatory partition',
    description:
      'Generate plots and publish observatory reports when the ingest workflow emits a partition-ready event.',
    eventType: 'observatory.minute.partition-ready',
    eventSource: 'observatory.timestore-loader',
    predicates: [
      {
        path: '$.payload.datasetSlug',
        operator: 'equals',
        value: '{{ defaultParameters.timestoreDatasetSlug }}'
      }
    ],
    parameterTemplate: {
      partitionKey:
        "{{ event.payload.partitionKeyFields.window | default: event.payload.minute | default: event.payload.partitionKey }}",
      instrumentId: "{{ event.payload.instrumentId | default: 'unknown' }}",
      minute: '{{ event.payload.minute }}',
      rowsIngested: '{{ event.payload.rowsIngested }}',
      timestoreBaseUrl: '{{ trigger.metadata.timestore.baseUrl }}',
      timestoreDatasetSlug: '{{ trigger.metadata.timestore.datasetSlug }}',
      timestoreAuthToken: '{{ trigger.metadata.timestore.authToken }}',
      metastoreBaseUrl: '{{ trigger.metadata.metastore.baseUrl }}',
      metastoreNamespace: '{{ trigger.metadata.metastore.namespace }}',
      metastoreAuthToken: '{{ trigger.metadata.metastore.authToken }}',
      visualizationsPrefix: '{{ trigger.metadata.paths.visualizationsPrefix }}',
      reportsPrefix: '{{ trigger.metadata.paths.reportsPrefix }}',
      filestoreBaseUrl: '{{ trigger.metadata.filestore.baseUrl }}',
      filestoreBackendId: '{{ trigger.metadata.filestore.backendMountId }}',
      filestoreBackendKey: '{{ trigger.metadata.filestore.backendMountKey }}'
    },
    runKeyTemplate:
      "observatory-publish-{{ parameters.instrumentId | replace: ':', '-' }}-{{ parameters.partitionKey | replace: ':', '-' }}",
    idempotencyKeyExpression:
      "{{ event.payload.instrumentId | default: 'unknown' | replace: ':', '-' }}-{{ event.payload.partitionKey | replace: ':', '-' }}",
    metadata: {
      timestore: {
        baseUrl: '{{ defaultParameters.timestoreBaseUrl }}',
        datasetSlug: '{{ defaultParameters.timestoreDatasetSlug }}',
        authToken: '{{ defaultParameters.timestoreAuthToken }}'
      },
      paths: {
        visualizationsPrefix: '{{ defaultParameters.visualizationsPrefix }}',
        reportsPrefix: '{{ defaultParameters.reportsPrefix }}'
      },
      metastore: {
        baseUrl: '{{ defaultParameters.metastoreBaseUrl }}',
        namespace: '{{ defaultParameters.metastoreNamespace }}',
        authToken: '{{ defaultParameters.metastoreAuthToken }}'
      }
    }
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
