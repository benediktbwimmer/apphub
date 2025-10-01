import { createWorkflow, createWorkflowTrigger, type WorkflowDefinition } from '@apphub/module-sdk';

import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';

const definition: WorkflowDefinition = {
  slug: 'observatory-minute-ingest',
  name: 'Observatory Minute Ingest',
  version: 1,
  description: 'Normalizes inbox CSVs and persists minute-level readings into Timestore.',
  parametersSchema: {
    type: 'object',
    properties: {
      minute: {
        type: 'string',
        minLength: 1
      },
      maxFiles: {
        type: 'number',
        minimum: 1,
        maximum: 200
      },
      filestoreBaseUrl: {
        type: 'string',
        minLength: 1
      },
      filestoreBackendId: {
        type: ['integer', 'null'],
        minimum: 1
      },
      filestoreToken: {
        type: 'string'
      },
      inboxPrefix: {
        type: 'string',
        minLength: 1
      },
      stagingPrefix: {
        type: 'string',
        minLength: 1
      },
      archivePrefix: {
        type: 'string',
        minLength: 1
      },
      filestorePrincipal: {
        type: 'string'
      },
      commandPath: {
        type: 'string'
      },
      timestoreBaseUrl: {
        type: 'string',
        minLength: 1
      },
      timestoreDatasetSlug: {
        type: 'string',
        minLength: 1
      },
      timestoreDatasetName: {
        type: 'string'
      },
      timestoreTableName: {
        type: 'string'
      },
      timestoreStorageTargetId: {
        type: 'string'
      },
      timestoreAuthToken: {
        type: 'string'
      },
      calibrationsBaseUrl: {
        type: 'string'
      },
      calibrationsNamespace: {
        type: 'string'
      },
      calibrationsAuthToken: {
        type: 'string'
      },
      filestoreBackendKey: {
        type: 'string',
        minLength: 1
      }
    },
    required: [
      'minute',
      'filestoreBaseUrl',
      'inboxPrefix',
      'stagingPrefix',
      'archivePrefix',
      'timestoreBaseUrl',
      'timestoreDatasetSlug',
      'filestoreBackendKey'
    ]
  },
  defaultParameters: {
    maxFiles: 1,
    filestoreBaseUrl: 'http://127.0.0.1:4300',
    filestoreBackendId: 1,
    inboxPrefix: 'datasets/observatory/inbox',
    stagingPrefix: 'datasets/observatory/staging',
    archivePrefix: 'datasets/observatory/archive',
    filestorePrincipal: 'observatory-inbox-normalizer',
    timestoreBaseUrl: 'http://127.0.0.1:4200',
    timestoreDatasetSlug: 'observatory-timeseries',
    timestoreDatasetName: 'Observatory Time Series',
    timestoreTableName: 'observations',
    filestoreToken: null,
    timestoreStorageTargetId: null,
    timestoreAuthToken: null,
    metastoreBaseUrl: null,
    metastoreNamespace: 'observatory.ingest',
    metastoreAuthToken: null,
    calibrationsBaseUrl: null,
    calibrationsNamespace: 'observatory.calibrations',
    calibrationsAuthToken: null,
    filestoreBackendKey: 'observatory-event-driven-s3'
  },
  steps: [
    {
      id: 'normalize-inbox',
      name: 'Normalize inbox files',
      type: 'job',
      jobSlug: 'observatory-inbox-normalizer',
      parameters: {
        minute: '{{ parameters.minute }}',
        maxFiles: '{{ parameters.maxFiles }}',
        filestoreBaseUrl: '{{ parameters.filestoreBaseUrl }}',
        filestoreBackendId: '{{ parameters.filestoreBackendId }}',
        filestoreToken: '{{ parameters.filestoreToken }}',
        inboxPrefix: '{{ parameters.inboxPrefix }}',
        stagingPrefix: '{{ parameters.stagingPrefix }}',
        archivePrefix: '{{ parameters.archivePrefix }}',
        principal: '{{ parameters.filestorePrincipal }}',
        commandPath: '{{ parameters.commandPath }}',
        metastoreBaseUrl: '{{ parameters.metastoreBaseUrl }}',
        metastoreNamespace: '{{ parameters.metastoreNamespace }}',
        metastoreAuthToken: '{{ parameters.metastoreAuthToken }}',
        filestoreBackendKey: '{{ parameters.filestoreBackendKey }}'
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
          },
          schema: {
            type: 'object',
            properties: {
              minute: { type: 'string' },
              instrumentId: { type: 'string' },
              normalizedFiles: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    path: { type: 'string' },
                    nodeId: { type: 'number' },
                    sizeBytes: { type: 'number' },
                    checksum: { type: 'string' },
                    rows: { type: 'number' },
                    site: { type: 'string' }
                  },
                  required: ['path', 'nodeId']
                }
              }
            },
            required: ['minute', 'normalizedFiles']
          }
        }
      ]
    },
    {
      id: 'load-timestore',
      name: 'Load timestore partition',
      type: 'job',
      jobSlug: 'observatory-timestore-loader',
      parameters: {
        minute: '{{ parameters.minute }}',
        datasetSlug: '{{ parameters.timestoreDatasetSlug }}',
        datasetName: '{{ parameters.timestoreDatasetName }}',
        tableName: '{{ parameters.timestoreTableName }}',
        storageTargetId: '{{ parameters.timestoreStorageTargetId }}',
        timestoreBaseUrl: '{{ parameters.timestoreBaseUrl }}',
        timestoreAuthToken: '{{ parameters.timestoreAuthToken }}',
        partitionNamespace: 'observatory',
        rawAsset: '{{ steps.normalize-inbox.result }}',
        filestoreBackendId: '{{ parameters.filestoreBackendId }}',
        filestoreBackendKey: '{{ parameters.filestoreBackendKey }}',
        idempotencyKey: '{{ parameters.commandPath | default: parameters.minute }}',
        calibrationsBaseUrl: '{{ parameters.calibrationsBaseUrl }}',
        calibrationsNamespace: '{{ parameters.calibrationsNamespace }}',
        calibrationsAuthToken: '{{ parameters.calibrationsAuthToken }}'
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
          schema: {
            type: 'object',
            properties: {
              partitionKey: { type: 'string' },
              datasetSlug: { type: 'string' },
              rowCount: { type: 'number' },
              storageTargetId: { type: 'string' },
              calibrationId: { type: ['string', 'null'] },
              calibrationEffectiveAt: { type: ['string', 'null'], format: 'date-time' },
              calibrationMetastoreVersion: { type: ['number', 'null'] }
            },
            required: ['partitionKey', 'datasetSlug', 'rowCount']
          }
        }
      ]
    }
  ]
};

const triggers = [
  createWorkflowTrigger({
    name: 'Observatory ingest on filestore upload',
    description:
      'Kick off the minute ingest workflow whenever new observatory CSV uploads land in Filestore.',
    eventType: 'filestore.command.completed',
    eventSource: 'filestore.service',
    predicates: [
      {
        path: '$.payload.command',
        operator: 'equals',
        value: 'uploadFile'
      },
      {
        path: '$.payload.backendMountId',
        operator: 'equals',
        value: '{{ defaultParameters.filestoreBackendId }}'
      }
    ],
    parameterTemplate: {
      minute: '{{ event.payload.node.metadata.minute }}',
      instrumentId:
        "{{ event.payload.node.metadata.instrumentId | default: event.payload.node.metadata.instrument_id | default: 'unknown' }}",
      maxFiles: '{{ trigger.metadata.maxFiles }}',
      filestoreBaseUrl: '{{ trigger.metadata.filestore.baseUrl }}',
      filestoreBackendId: '{{ trigger.metadata.filestore.backendMountId }}',
      filestoreToken: '{{ trigger.metadata.filestore.token }}',
      inboxPrefix: '{{ trigger.metadata.filestore.inboxPrefix }}',
      stagingPrefix: '{{ trigger.metadata.filestore.stagingPrefix }}',
      archivePrefix: '{{ trigger.metadata.filestore.archivePrefix }}',
      filestorePrincipal:
        '{{ trigger.metadata.filestore.principal | default: event.payload.principal }}',
      commandPath: '{{ event.payload.path }}',
      timestoreBaseUrl: '{{ trigger.metadata.timestore.baseUrl }}',
      timestoreDatasetSlug: '{{ trigger.metadata.timestore.datasetSlug }}',
      timestoreDatasetName: '{{ trigger.metadata.timestore.datasetName }}',
      timestoreTableName: '{{ trigger.metadata.timestore.tableName }}',
      timestoreStorageTargetId: '{{ trigger.metadata.timestore.storageTargetId }}',
      timestoreAuthToken: '{{ trigger.metadata.timestore.authToken }}',
      metastoreBaseUrl: '{{ trigger.metadata.metastore.baseUrl }}',
      metastoreNamespace: '{{ trigger.metadata.metastore.namespace }}',
      metastoreAuthToken: '{{ trigger.metadata.metastore.authToken }}',
      calibrationsBaseUrl: '{{ trigger.metadata.calibrations.baseUrl }}',
      calibrationsNamespace: '{{ trigger.metadata.calibrations.namespace }}',
      calibrationsAuthToken: '{{ trigger.metadata.calibrations.authToken }}',
      filestoreBackendKey: '{{ trigger.metadata.filestore.backendMountKey }}'
    },
    runKeyTemplate:
      "observatory-ingest-{{ parameters.instrumentId | default: 'unknown' | replace: ':', '-' }}-{{ parameters.minute | replace: ':', '-' }}",
    idempotencyKeyExpression:
      "{{ event.payload.node.metadata.minute }}-{{ event.payload.path | replace: '/', '_' | replace: ':', '-' }}",
    metadata: {
      maxFiles: '{{ defaultParameters.maxFiles }}',
      filestore: {
        baseUrl: '{{ defaultParameters.filestoreBaseUrl }}',
        backendMountId: '{{ defaultParameters.filestoreBackendId }}',
        token: '{{ defaultParameters.filestoreToken }}',
        inboxPrefix: '{{ defaultParameters.inboxPrefix }}',
        stagingPrefix: '{{ defaultParameters.stagingPrefix }}',
        archivePrefix: '{{ defaultParameters.archivePrefix }}',
        principal: '{{ defaultParameters.filestorePrincipal }}',
        backendMountKey: '{{ defaultParameters.filestoreBackendKey }}'
      },
      timestore: {
        baseUrl: '{{ defaultParameters.timestoreBaseUrl }}',
        datasetSlug: '{{ defaultParameters.timestoreDatasetSlug }}',
        datasetName: '{{ defaultParameters.timestoreDatasetName }}',
        tableName: '{{ defaultParameters.timestoreTableName }}',
        storageTargetId: '{{ defaultParameters.timestoreStorageTargetId }}',
        authToken: '{{ defaultParameters.timestoreAuthToken }}'
      },
      metastore: {
        baseUrl: '{{ defaultParameters.metastoreBaseUrl }}',
        namespace: '{{ defaultParameters.metastoreNamespace }}',
        authToken: '{{ defaultParameters.metastoreAuthToken }}'
      },
      calibrations: {
        baseUrl: '{{ defaultParameters.calibrationsBaseUrl }}',
        namespace: '{{ defaultParameters.calibrationsNamespace }}',
        authToken: '{{ defaultParameters.calibrationsAuthToken }}'
      }
    }
  })
];

export const minuteIngestWorkflow = createWorkflow<ObservatoryModuleSettings, ObservatoryModuleSecrets>({
  name: definition.slug,
  displayName: definition.name,
  description: definition.description,
  definition,
  triggers
});
