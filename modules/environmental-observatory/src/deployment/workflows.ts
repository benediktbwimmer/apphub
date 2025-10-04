import type { EventDrivenObservatoryConfig } from './configBuilder';
import type { WorkflowProvisioningEventTrigger, JsonValue } from '@apphub/module-registry';

export type ObservatoryTriggerDefinition = WorkflowProvisioningEventTrigger & {
  workflowSlug: string;
};

export function buildTriggerDefinitions(
  config: EventDrivenObservatoryConfig
): ObservatoryTriggerDefinition[] {
  const ingestMetadata: Record<string, unknown> = {
    maxFiles: 1000,
    filestore: {
      baseUrl: config.filestore.baseUrl,
      backendMountId: config.filestore.backendMountId,
      token: config.filestore.token ?? null,
      inboxPrefix: config.filestore.inboxPrefix,
      stagingPrefix: config.filestore.stagingPrefix,
      archivePrefix: config.filestore.archivePrefix,
      principal: 'observatory-inbox-normalizer',
      calibrationsPrefix: config.filestore.calibrationsPrefix,
      plansPrefix: config.filestore.plansPrefix ?? null
    },
    timestore: {
      baseUrl: config.timestore.baseUrl,
      datasetSlug: config.timestore.datasetSlug,
      datasetName: config.timestore.datasetName ?? null,
      tableName: config.timestore.tableName ?? null,
      storageTargetId: config.timestore.storageTargetId ?? null,
      authToken: config.timestore.authToken ?? null
    }
  };

  const timestoreMetadata: Record<string, unknown> = {
    baseUrl: config.timestore.baseUrl,
    datasetSlug: config.timestore.datasetSlug,
    authToken: config.timestore.authToken ?? null
  };

  const publicationMetadata: Record<string, unknown> = {
    filestore: {
      baseUrl: config.filestore.baseUrl,
      backendMountId: config.filestore.backendMountId,
      token: config.filestore.token ?? null,
      principal: 'observatory-visualization-runner',
      visualizationsPrefix: config.filestore.visualizationsPrefix ?? 'datasets/observatory/visualizations',
      reportsPrefix: config.filestore.reportsPrefix ?? 'datasets/observatory/reports'
    },
    timestore: timestoreMetadata,
    metastore: {
      baseUrl: config.metastore?.baseUrl ?? null,
      namespace: config.metastore?.namespace ?? null,
      authToken: config.metastore?.authToken ?? null
    }
  };

  const aggregateMetadata: Record<string, unknown> = {
    timestore: timestoreMetadata,
    filestore: {
      baseUrl: config.filestore.baseUrl,
      backendMountId: config.filestore.backendMountId,
      token: config.filestore.token ?? null,
      principal: 'observatory-dashboard-aggregator',
      reportsPrefix: config.filestore.reportsPrefix ?? 'datasets/observatory/reports',
      overviewPrefix: config.workflows.dashboard?.overviewPrefix ??
        `${config.filestore.reportsPrefix ?? 'datasets/observatory/reports'}/overview`
    },
    lookbackMinutes: config.workflows.dashboard?.lookbackMinutes ?? 720
  };

  return [
    {
      workflowSlug: config.workflows.ingestSlug,
      name: 'observatory-minute.raw-uploaded',
      description: 'Kick off minute ingest whenever normalized inbox files are ready.',
      eventType: 'observatory.minute.raw-uploaded',
      predicates: [],
      parameterTemplate: {
        minute: '{{ trigger.payload.minute }}',
        filestoreBaseUrl: config.filestore.baseUrl,
        filestoreBackendId: config.filestore.backendMountId ?? null,
        filestoreToken: config.filestore.token ?? null,
        inboxPrefix: config.filestore.inboxPrefix,
        stagingPrefix: config.filestore.stagingPrefix,
        archivePrefix: config.filestore.archivePrefix,
        filestorePrincipal: 'observatory-inbox-normalizer',
        timestoreBaseUrl: config.timestore.baseUrl,
        timestoreDatasetSlug: config.timestore.datasetSlug,
        timestoreDatasetName: config.timestore.datasetName ?? null,
        timestoreTableName: config.timestore.tableName ?? null,
        timestoreStorageTargetId: config.timestore.storageTargetId ?? null,
        timestoreAuthToken: config.timestore.authToken ?? null
      },
      metadata: ingestMetadata as JsonValue
    },
    {
      workflowSlug: config.workflows.publicationSlug,
      name: 'observatory-minute.partition-ready',
      description: 'Regenerate plots and reports once a Timestore partition is ready.',
      eventType: 'observatory.minute.partition-ready',
      predicates: [],
      parameterTemplate: {
        timestoreBaseUrl: config.timestore.baseUrl,
        timestoreDatasetSlug: config.timestore.datasetSlug,
        timestoreAuthToken: config.timestore.authToken ?? null,
        partitionKey:
          "{{ event.payload.partitionKey | default: event.payload.partitionKeyFields.window | default: event.payload.minute }}",
        instrumentId: "{{ event.payload.instrumentId | default: event.payload.partitionKeyFields.instrument | default: 'unknown' }}",
        minute: '{{ event.payload.minute }}',
        rowsIngested: '{{ event.payload.rowsIngested }}',
        filestoreBaseUrl: config.filestore.baseUrl,
        filestoreBackendId: config.filestore.backendMountId ?? null,
        filestoreToken: config.filestore.token ?? null,
        filestorePrincipal: 'observatory-visualization-runner',
        visualizationsPrefix: config.filestore.visualizationsPrefix ?? 'datasets/observatory/visualizations',
        reportsPrefix: config.filestore.reportsPrefix ?? 'datasets/observatory/reports'
      },
      metadata: publicationMetadata as JsonValue,
      runKeyTemplate: '{{ trigger.payload.partitionKey }}'
    },
    {
      workflowSlug: config.workflows.aggregateSlug,
      name: 'timestore.partition.created',
      description: 'Generate dashboard aggregates once partitions land.',
      eventType: 'timestore.partition.created',
      predicates: [
        {
          path: '$.payload.datasetSlug',
          operator: 'equals',
          value: config.timestore.datasetSlug
        }
      ],
      parameterTemplate: {
        timestoreBaseUrl: config.timestore.baseUrl,
        timestoreDatasetSlug: config.timestore.datasetSlug,
        timestoreAuthToken: config.timestore.authToken ?? null,
        partitionKey: '{{ trigger.payload.partitionKey }}',
        filestoreBaseUrl: config.filestore.baseUrl,
        filestoreBackendId: config.filestore.backendMountId ?? null,
        filestoreToken: config.filestore.token ?? null,
        filestorePrincipal: 'observatory-dashboard-aggregator',
        reportsPrefix: config.filestore.reportsPrefix ?? 'datasets/observatory/reports',
        overviewPrefix: config.workflows.dashboard?.overviewPrefix ??
          `${config.filestore.reportsPrefix ?? 'datasets/observatory/reports'}/overview`,
        lookbackMinutes: config.workflows.dashboard?.lookbackMinutes ?? 720
      },
      metadata: aggregateMetadata as JsonValue,
      runKeyTemplate: '{{ trigger.payload.partitionKey }}'
    }
  ];
}
