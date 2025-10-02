import { createWorkflow, createWorkflowTrigger, type WorkflowDefinition } from '@apphub/module-sdk';

import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';

const definition: WorkflowDefinition = {
  slug: 'observatory-dashboard-aggregate',
  name: 'Observatory Dashboard Aggregate',
  description: 'Aggregate recent observatory readings and render the interactive overview dashboard.',
  parametersSchema: {
    type: 'object',
    properties: {
      partitionKey: { type: 'string', minLength: 1 },
      lookbackMinutes: { type: 'number', minimum: 5, maximum: 4320 },
      timestoreBaseUrl: { type: 'string', minLength: 1 },
      timestoreDatasetSlug: { type: 'string', minLength: 1 },
      timestoreAuthToken: { type: 'string' },
      filestoreBaseUrl: { type: 'string', minLength: 1 },
      filestoreBackendId: { type: ['integer', 'null'], minimum: 1 },
      filestoreToken: { type: 'string' },
      filestorePrincipal: { type: 'string' },
      reportsPrefix: { type: 'string', minLength: 1 },
      overviewPrefix: { type: 'string', minLength: 1 },
      filestoreBackendKey: { type: 'string', minLength: 1 }
    },
    required: [
      'partitionKey',
      'lookbackMinutes',
      'timestoreBaseUrl',
      'timestoreDatasetSlug',
      'filestoreBaseUrl',
      'reportsPrefix',
      'overviewPrefix',
      'filestoreBackendKey'
    ]
  },
  defaultParameters: {
    lookbackMinutes: 720,
    timestoreBaseUrl: 'http://127.0.0.1:4200',
    timestoreDatasetSlug: 'observatory-timeseries',
    timestoreAuthToken: null,
    reportsPrefix: 'datasets/observatory/reports',
    overviewPrefix: 'datasets/observatory/reports/overview',
    filestoreBaseUrl: 'http://127.0.0.1:4300',
    filestoreBackendId: 1,
    filestoreToken: null,
    filestorePrincipal: null,
    filestoreBackendKey: 'observatory-event-driven-s3'
  },
  steps: [
    {
      id: 'aggregate-dashboard',
      name: 'Aggregate dashboard',
      type: 'job',
      jobSlug: 'observatory-dashboard-aggregator',
      parameters: {
        partitionKey: '{{ parameters.partitionKey }}',
        lookbackMinutes: '{{ parameters.lookbackMinutes }}',
        timestoreBaseUrl: '{{ parameters.timestoreBaseUrl }}',
        timestoreDatasetSlug: '{{ parameters.timestoreDatasetSlug }}',
        timestoreAuthToken: '{{ parameters.timestoreAuthToken }}',
        filestoreBaseUrl: '{{ parameters.filestoreBaseUrl }}',
        filestoreBackendId: '{{ parameters.filestoreBackendId }}',
        filestoreToken: '{{ parameters.filestoreToken }}',
        filestorePrincipal: '{{ parameters.filestorePrincipal }}',
        reportsPrefix: '{{ parameters.reportsPrefix }}',
        overviewPrefix: '{{ parameters.overviewPrefix }}',
        filestoreBackendKey: '{{ parameters.filestoreBackendKey }}'
      }
    }
  ]
};

const triggers = [
  createWorkflowTrigger({
    name: 'Observatory dashboard aggregate',
    description: 'Refresh the aggregate dashboard whenever new observatory partitions arrive.',
    eventType: 'timestore.partition.created',
    eventSource: 'timestore.ingest',
    predicates: [
      {
        path: '$.payload.datasetSlug',
        operator: 'equals',
        value: '{{ defaultParameters.timestoreDatasetSlug }}'
      }
    ],
    parameterTemplate: {
      partitionKey: '{{ event.payload.partitionKeyFields.window | default: event.payload.partitionKey }}',
      lookbackMinutes: '{{ trigger.metadata.dashboard.lookbackMinutes }}',
      timestoreBaseUrl: '{{ trigger.metadata.timestore.baseUrl }}',
      timestoreDatasetSlug: '{{ trigger.metadata.timestore.datasetSlug }}',
      timestoreAuthToken: '{{ trigger.metadata.timestore.authToken }}',
      filestoreBaseUrl: '{{ trigger.metadata.filestore.baseUrl }}',
      filestoreBackendId: '{{ trigger.metadata.filestore.backendMountId }}',
      reportsPrefix: '{{ trigger.metadata.paths.reportsPrefix }}',
      overviewPrefix: '{{ trigger.metadata.dashboard.overviewPrefix }}',
      filestoreToken: '{{ trigger.metadata.filestore.token }}',
      filestorePrincipal: '{{ trigger.metadata.filestore.principal }}',
      filestoreBackendKey: '{{ trigger.metadata.filestore.backendMountKey }}'
    },
    idempotencyKeyExpression:
      'dashboard-aggregate-{{ event.payload.partitionKeyFields.window | default: event.payload.partitionKey }}',
    metadata: {
      paths: {
        reportsPrefix: '{{ defaultParameters.reportsPrefix }}'
      },
      timestore: {
        baseUrl: '{{ defaultParameters.timestoreBaseUrl }}',
        datasetSlug: '{{ defaultParameters.timestoreDatasetSlug }}',
        authToken: '{{ defaultParameters.timestoreAuthToken }}'
      },
      dashboard: {
        overviewDirName: "{{ defaultParameters.overviewDirName | default: 'overview' }}",
        lookbackMinutes: '{{ defaultParameters.lookbackMinutes }}',
        overviewPrefix: '{{ defaultParameters.overviewPrefix }}'
      }
    }
  }),
  createWorkflowTrigger({
    name: 'Observatory dashboard aggregate (fallback)',
    description: 'Fallback trigger so dashboards refresh as soon as the ingest workflow finishes staging.',
    eventType: 'observatory.minute.partition-ready',
    eventSource: 'observatory.events',
    predicates: [
      {
        path: '$.payload.datasetSlug',
        operator: 'equals',
        value: '{{ defaultParameters.timestoreDatasetSlug }}'
      }
    ],
    parameterTemplate: {
      partitionKey: '{{ event.payload.partitionKeyFields.window | default: event.payload.minute }}',
      lookbackMinutes: '{{ trigger.metadata.dashboard.lookbackMinutes }}',
      timestoreBaseUrl: '{{ trigger.metadata.timestore.baseUrl }}',
      timestoreDatasetSlug: '{{ trigger.metadata.timestore.datasetSlug }}',
      timestoreAuthToken: '{{ trigger.metadata.timestore.authToken }}',
      filestoreBaseUrl: '{{ trigger.metadata.filestore.baseUrl }}',
      filestoreBackendId: '{{ trigger.metadata.filestore.backendMountId }}',
      reportsPrefix: '{{ trigger.metadata.paths.reportsPrefix }}',
      overviewPrefix: '{{ trigger.metadata.dashboard.overviewPrefix }}',
      filestoreToken: '{{ trigger.metadata.filestore.token }}',
      filestorePrincipal: '{{ trigger.metadata.filestore.principal }}',
      filestoreBackendKey: '{{ trigger.metadata.filestore.backendMountKey }}'
    },
    idempotencyKeyExpression:
      'dashboard-aggregate-{{ event.payload.partitionKeyFields.window | default: event.payload.minute }}',
    metadata: {
      paths: {
        reportsPrefix: '{{ defaultParameters.reportsPrefix }}'
      },
      timestore: {
        baseUrl: '{{ defaultParameters.timestoreBaseUrl }}',
        datasetSlug: '{{ defaultParameters.timestoreDatasetSlug }}',
        authToken: '{{ defaultParameters.timestoreAuthToken }}'
      },
      dashboard: {
        overviewDirName: "{{ defaultParameters.overviewDirName | default: 'overview' }}",
        lookbackMinutes: '{{ defaultParameters.lookbackMinutes }}',
        overviewPrefix: '{{ defaultParameters.overviewPrefix }}'
      }
    }
  })
];

export const dashboardAggregateWorkflow = createWorkflow<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets
>({
  name: definition.slug,
  displayName: definition.name,
  description: definition.description,
  definition,
  triggers
});
