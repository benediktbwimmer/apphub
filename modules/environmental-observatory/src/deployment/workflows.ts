import type { EventDrivenObservatoryConfig } from './configBuilder';
import type { WorkflowProvisioningEventTrigger, JsonValue } from '@apphub/module-registry';

export type ObservatoryTriggerDefinition = WorkflowProvisioningEventTrigger & {
  workflowSlug: string;
};

export function buildTriggerDefinitions(
  config: EventDrivenObservatoryConfig
): ObservatoryTriggerDefinition[] {
  const ingestMetadata: Record<string, unknown> = {
    maxFiles: 200,
    filestore: {
      baseUrl: config.filestore.baseUrl,
      backendMountId: config.filestore.backendMountId,
      backendMountKey: config.filestore.backendMountKey,
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
    },
    metastore: {
      baseUrl: config.metastore?.baseUrl ?? null,
      namespace: config.metastore?.namespace ?? null,
      authToken: config.metastore?.authToken ?? null
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
    },
    lookbackMinutes: config.workflows.dashboard?.lookbackMinutes ?? 720
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

  const ingestPredicates: WorkflowProvisioningEventTrigger['predicates'] = [
    {
      path: '$.payload.command',
      operator: 'equals',
      value: 'uploadFile'
    }
  ];

  if (typeof config.filestore.backendMountId === 'number') {
    ingestPredicates.push({
      path: '$.payload.backendMountId',
      operator: 'equals',
      value: config.filestore.backendMountId
    });
  }

  ingestPredicates.push({
    path: '$.payload.node.metadata.minute',
    operator: 'exists'
  });

  return [
    {
      workflowSlug: config.workflows.ingestSlug,
      name: 'observatory-minute.raw-uploaded',
      description: 'Kick off minute ingest whenever normalized inbox files are ready.',
      eventType: 'filestore.command.completed',
      eventSource: 'filestore.service',
      predicates: ingestPredicates,
      parameterTemplate: {
        minute:
          "{{ event.payload.node.metadata.minute | default: event.payload.node.metadata.minuteKey | default: event.payload.node.metadata.window }}",
        instrumentId:
          "{{ event.payload.node.metadata.instrumentId | default: event.payload.node.metadata.instrument_id | default: 'unknown' }}",
        maxFiles: '{{ trigger.metadata.maxFiles }}',
        filestoreBaseUrl: config.filestore.baseUrl,
        filestoreBackendId: config.filestore.backendMountId ?? null,
        filestoreToken: config.filestore.token ?? null,
        inboxPrefix: config.filestore.inboxPrefix,
        stagingPrefix: config.filestore.stagingPrefix,
        archivePrefix: config.filestore.archivePrefix,
        filestorePrincipal: 'observatory-inbox-normalizer',
        commandPath: '{{ event.payload.path }}',
        filestoreBackendKey: config.filestore.backendMountKey,
        timestoreBaseUrl: config.timestore.baseUrl,
        timestoreDatasetSlug: config.timestore.datasetSlug,
        timestoreDatasetName: config.timestore.datasetName ?? null,
        timestoreTableName: config.timestore.tableName ?? null,
        timestoreStorageTargetId: config.timestore.storageTargetId ?? null,
        timestoreAuthToken: config.timestore.authToken ?? null,
        metastoreBaseUrl: config.metastore?.baseUrl ?? null,
        metastoreNamespace: config.metastore?.namespace ?? null,
        metastoreAuthToken: config.metastore?.authToken ?? null
      },
      metadata: ingestMetadata as JsonValue,
      runKeyTemplate:
        "observatory-ingest-{{ parameters.instrumentId | default: 'unknown' | replace: ':', '-' }}-{{ parameters.minute | replace: ':', '-' }}",
      idempotencyKeyExpression:
        "{{ event.payload.node.metadata.minute }}-{{ event.payload.path | replace: '/', '_' | replace: ':', '-' }}"
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
          "{{ event.payload.partitionKeyFields.window | default: event.payload.minute | default: event.payload.partitionKey }}",
        instrumentId: "{{ event.payload.instrumentId | default: event.payload.partitionKeyFields.instrument | default: 'unknown' }}",
        minute: '{{ event.payload.minute }}',
        rowsIngested: '{{ event.payload.rowsIngested }}',
        filestoreBaseUrl: config.filestore.baseUrl,
        filestoreBackendId: config.filestore.backendMountId ?? null,
        filestoreToken: config.filestore.token ?? null,
        filestorePrincipal: 'observatory-visualization-runner',
        visualizationsPrefix: config.filestore.visualizationsPrefix ?? 'datasets/observatory/visualizations',
        reportsPrefix: config.filestore.reportsPrefix ?? 'datasets/observatory/reports',
        lookbackMinutes: '{{ trigger.metadata.lookbackMinutes }}'
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
        partitionKey:
          "{{ event.payload.partitionKeyFields.window | default: event.payload.partitionKey | default: trigger.payload.partitionKey | default: trigger.metadata.partitionKey }}",
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
