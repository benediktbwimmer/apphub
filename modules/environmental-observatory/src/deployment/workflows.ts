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
      rawPrefix: config.filestore.inboxPrefix,
      principal: 'observatory-minute-preprocessor',
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
      overviewPrefix:
        config.workflows.dashboard?.overviewPrefix ??
        `${config.filestore.reportsPrefix ?? 'datasets/observatory/reports'}/overview`
    },
    lookbackMinutes: config.workflows.dashboard?.lookbackMinutes ?? 720,
    burstQuietMs: config.workflows.dashboard?.burstQuietMillis ?? 5_000,
    snapshotFreshnessMs: config.workflows.dashboard?.snapshotFreshnessMillis ?? 60_000
  };

  const ingestPredicates: WorkflowProvisioningEventTrigger['predicates'] = [
    { path: '$.payload.command', operator: 'equals', value: 'uploadFile' },
    { path: '$.payload.node.metadata.minute', operator: 'exists' }
  ];

  if (typeof config.filestore.backendMountId === 'number') {
    ingestPredicates.splice(1, 0, {
      path: '$.payload.backendMountId',
      operator: 'equals',
      value: config.filestore.backendMountId
    });
  }

  return [
    {
      workflowSlug: config.workflows.ingestSlug,
      name: 'observatory-minute.ingest-trigger',
      description: 'Kick off minute ingest whenever a CSV is uploaded to the raw prefix.',
      eventType: 'filestore.command.completed',
      eventSource: 'filestore.service',
      predicates: ingestPredicates,
      parameterTemplate: {
        minute:
          "{{ event.payload.node.metadata.minute | default: event.payload.node.metadata.minuteKey | default: event.payload.node.metadata.window }}",
        instrumentId:
          "{{ event.payload.node.metadata.instrumentId | default: event.payload.node.metadata.instrument_id | default: 'unknown' }}",
        maxFiles: '{{ trigger.metadata.maxFiles }}',
        commandPath: '{{ event.payload.path }}',
        inboxPrefix: config.filestore.inboxPrefix,
        filestoreBaseUrl: config.filestore.baseUrl,
        filestoreBackendId: config.filestore.backendMountId ?? null,
        filestoreBackendKey: config.filestore.backendMountKey,
        filestoreToken: config.filestore.token ?? null
      },
      metadata: ingestMetadata as JsonValue,
      runKeyTemplate:
        "observatory-ingest-{{ parameters.instrumentId | default: 'unknown' | replace: ':', '-' }}-{{ parameters.minute | replace: ':', '-' }}",
      idempotencyKeyExpression:
        "{{ event.payload.node.metadata.minute }}-{{ event.payload.path | replace: '/', '_' | replace: ':', '-' }}"
    },
    {
      workflowSlug: config.workflows.publicationSlug,
      name: 'observatory-minute.asset-ready',
      description: 'Regenerate plots and reports once a timestore asset materializes.',
      eventType: 'observatory.asset.materialized',
      predicates: [
        {
          path: '$.payload.assetId',
          operator: 'equals',
          value: 'observatory.timeseries.timestore'
        }
      ],
      parameterTemplate: {
        partitionKey: '{{ event.payload.partitionKey }}',
        instrumentId: '{{ event.payload.metadata.instrumentId }}',
        rowsIngested: '{{ event.payload.metadata.rowsIngested }}',
        timestoreBaseUrl: config.timestore.baseUrl,
        timestoreDatasetSlug: config.timestore.datasetSlug,
        timestoreAuthToken: config.timestore.authToken ?? null,
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
      name: 'observatory-burst.ready',
      description: 'Generate dashboard aggregates once a burst quiet window completes.',
      eventType: 'observatory.asset.materialized',
      predicates: [
        {
          path: '$.payload.assetId',
          operator: 'equals',
          value: 'observatory.burst.ready'
        }
      ],
      parameterTemplate: {
        partitionKey: '{{ event.payload.partitionKey }}',
        burstReason: '{{ event.payload.metadata.reason }}',
        burstFinishedAt: '{{ event.payload.producedAt }}',
        lookbackMinutes: config.workflows.dashboard?.lookbackMinutes ?? 720
      },
      metadata: aggregateMetadata as JsonValue
    }
  ];
}
