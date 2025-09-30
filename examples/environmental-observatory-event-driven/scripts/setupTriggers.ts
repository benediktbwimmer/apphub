import { fetch } from 'undici';
import { loadObservatoryConfig } from '../shared/config';

type TriggerDefinition = {
  workflowSlug: string;
  name: string;
  description: string;
  eventType: string;
  eventSource?: string | null;
  predicates: Array<{
    path: string;
    operator: 'equals' | 'notEquals' | 'in' | 'notIn' | 'exists';
    value?: unknown;
    values?: unknown[];
  }>;
  parameterTemplate: Record<string, unknown>;
  metadata: Record<string, unknown>;
  throttleWindowMs?: number;
  throttleCount?: number;
  maxConcurrency?: number;
  idempotencyKeyExpression?: string;
  runKeyTemplate?: string;
};

async function request<T>(
  baseUrl: string,
  token: string,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Catalog request failed (${response.status}): ${text}`);
  }

  return (await response.json()) as T;
}

async function ensureTrigger(
  baseUrl: string,
  token: string,
  definition: TriggerDefinition
): Promise<void> {
  type TriggerRecord = {
    id: string;
    name: string | null;
  };

  const existing = await request<{ data: TriggerRecord[] | { triggers: TriggerRecord[] } }>(
    baseUrl,
    token,
    'GET',
    `/workflows/${definition.workflowSlug}/triggers`
  );

  const data = existing.data as TriggerRecord[] | { triggers?: TriggerRecord[] };
  const triggerList = Array.isArray(data)
    ? data
    : Array.isArray(data.triggers)
      ? data.triggers
      : [];

  const current = triggerList.find((entry) => entry.name === definition.name);

  if (current) {
    await request(
      baseUrl,
      token,
      'PATCH',
      `/workflows/${definition.workflowSlug}/triggers/${current.id}`,
      {
        name: definition.name,
        description: definition.description,
        eventType: definition.eventType,
        eventSource: definition.eventSource ?? undefined,
        predicates: definition.predicates,
        parameterTemplate: definition.parameterTemplate,
        metadata: definition.metadata,
        throttleWindowMs: definition.throttleWindowMs,
        throttleCount: definition.throttleCount,
        maxConcurrency: definition.maxConcurrency,
        idempotencyKeyExpression: definition.idempotencyKeyExpression,
        runKeyTemplate: definition.runKeyTemplate
      }
    );
    console.log(`Updated trigger '${definition.name}' on workflow ${definition.workflowSlug}`);
    return;
  }

  await request(
    baseUrl,
    token,
    'POST',
    `/workflows/${definition.workflowSlug}/triggers`,
    {
      name: definition.name,
      description: definition.description,
      eventType: definition.eventType,
      eventSource: definition.eventSource ?? undefined,
      predicates: definition.predicates,
      parameterTemplate: definition.parameterTemplate,
      metadata: definition.metadata,
      throttleWindowMs: definition.throttleWindowMs,
      throttleCount: definition.throttleCount,
      maxConcurrency: definition.maxConcurrency,
      idempotencyKeyExpression: definition.idempotencyKeyExpression,
      runKeyTemplate: definition.runKeyTemplate
    }
  );
  console.log(`Created trigger '${definition.name}' on workflow ${definition.workflowSlug}`);
}

async function main(): Promise<void> {
  const config = loadObservatoryConfig();
  const catalogBaseUrl = config.catalog?.baseUrl ?? 'http://127.0.0.1:4000';
  const catalogToken = config.catalog?.apiToken;

  if (!catalogToken) {
    throw new Error('Catalog API token missing. Set catalog.apiToken in the observatory config.');
  }

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

  if (config.metastore?.baseUrl) {
    (ingestMetadata as Record<string, unknown>).metastore = {
      baseUrl: config.metastore.baseUrl,
      namespace: config.metastore.namespace ?? 'observatory.ingest',
      authToken: config.metastore.authToken ?? null
    } satisfies Record<string, unknown>;
  }

  (ingestMetadata as Record<string, unknown>).calibrations = {
    baseUrl: config.metastore?.baseUrl ?? null,
    namespace:
      config.metastore?.namespace && config.metastore.namespace !== 'observatory.ingest'
        ? config.metastore.namespace
        : 'observatory.calibrations',
    authToken: config.metastore?.authToken ?? null
  } satisfies Record<string, unknown>;

  const ingestTemplate: Record<string, unknown> = {
    minute: '{{ event.payload.node.metadata.minute }}',
    instrumentId: '{{ event.payload.node.metadata.instrumentId | default: event.payload.node.metadata.instrument_id | default: "unknown" }}',
    maxFiles: '{{ trigger.metadata.maxFiles }}',
    filestoreBaseUrl: '{{ trigger.metadata.filestore.baseUrl }}',
    filestoreBackendId: '{{ trigger.metadata.filestore.backendMountId }}',
    inboxPrefix: '{{ trigger.metadata.filestore.inboxPrefix }}',
    stagingPrefix: '{{ trigger.metadata.filestore.stagingPrefix }}',
    archivePrefix: '{{ trigger.metadata.filestore.archivePrefix }}',
    commandPath: '{{ event.payload.path }}',
    filestorePrincipal: '{{ trigger.metadata.filestore.principal | default: event.payload.principal }}',
    timestoreBaseUrl: '{{ trigger.metadata.timestore.baseUrl }}',
    timestoreDatasetSlug: '{{ trigger.metadata.timestore.datasetSlug }}',
    timestoreDatasetName: '{{ trigger.metadata.timestore.datasetName }}',
    timestoreTableName: '{{ trigger.metadata.timestore.tableName }}'
  };

  if (config.filestore.token) {
    ingestTemplate.filestoreToken = '{{ trigger.metadata.filestore.token }}';
  }
  if (config.timestore.storageTargetId) {
    ingestTemplate.timestoreStorageTargetId = '{{ trigger.metadata.timestore.storageTargetId }}';
  }
  if (config.timestore.authToken) {
    ingestTemplate.timestoreAuthToken = '{{ trigger.metadata.timestore.authToken }}';
  }
  if (config.metastore?.baseUrl) {
    ingestTemplate.metastoreBaseUrl = '{{ trigger.metadata.metastore.baseUrl }}';
    ingestTemplate.metastoreNamespace = '{{ trigger.metadata.metastore.namespace }}';
  }
  if (config.metastore?.authToken) {
    ingestTemplate.metastoreAuthToken = '{{ trigger.metadata.metastore.authToken }}';
  }

  ingestTemplate.calibrationsBaseUrl = '{{ trigger.metadata.calibrations.baseUrl }}';
  ingestTemplate.calibrationsNamespace = '{{ trigger.metadata.calibrations.namespace }}';
  if (config.metastore?.authToken) {
    ingestTemplate.calibrationsAuthToken = '{{ trigger.metadata.calibrations.authToken }}';
  }

  const publicationMetadata = {
    timestore: {
      baseUrl: config.timestore.baseUrl,
      datasetSlug: config.timestore.datasetSlug,
      authToken: config.timestore.authToken ?? null
    },
    filestore: {
      baseUrl: config.filestore.baseUrl,
      backendMountId: config.filestore.backendMountId,
      token: config.filestore.token ?? null,
      visualizationsPrefix: config.filestore.visualizationsPrefix ?? 'datasets/observatory/visualizations',
      reportsPrefix: config.filestore.reportsPrefix ?? 'datasets/observatory/reports',
      principal: 'observatory-visualization-runner'
    },
    metastore: {
      baseUrl: config.metastore?.baseUrl ?? null,
      namespace: config.metastore?.namespace ?? null,
      authToken: config.metastore?.authToken ?? null
    },
    calibrations: {
      prefix: config.filestore.calibrationsPrefix,
      plansPrefix: config.filestore.plansPrefix ?? null
    }
  } satisfies Record<string, unknown>;

  const publicationTemplate: Record<string, unknown> = {
    partitionKey: '{{ event.payload.partitionKey }}',
    instrumentId: '{{ event.payload.instrumentId | default: event.payload.partitionKeyFields.instrument | default: "unknown" }}',
    minute: '{{ event.payload.minute }}',
    rowsIngested: '{{ event.payload.rowsIngested }}',
    timestoreBaseUrl: '{{ trigger.metadata.timestore.baseUrl }}',
    timestoreDatasetSlug: '{{ trigger.metadata.timestore.datasetSlug }}',
    filestoreBaseUrl: '{{ trigger.metadata.filestore.baseUrl }}',
    filestoreBackendId: '{{ trigger.metadata.filestore.backendMountId }}',
    visualizationsPrefix: '{{ trigger.metadata.filestore.visualizationsPrefix }}',
    reportsPrefix: '{{ trigger.metadata.filestore.reportsPrefix }}'
  };

  if (config.timestore.authToken) {
    publicationTemplate.timestoreAuthToken = '{{ trigger.metadata.timestore.authToken }}';
  }
  if (config.filestore.token) {
    publicationTemplate.filestoreToken = '{{ trigger.metadata.filestore.token }}';
  }
  if (config.filestore.token || config.filestore.visualizationsPrefix || config.filestore.reportsPrefix) {
    publicationTemplate.filestorePrincipal = '{{ trigger.metadata.filestore.principal }}';
  }
  if (config.metastore?.baseUrl) {
    publicationTemplate.metastoreBaseUrl = '{{ trigger.metadata.metastore.baseUrl }}';
  }
  if (config.metastore?.authToken) {
    publicationTemplate.metastoreAuthToken = '{{ trigger.metadata.metastore.authToken }}';
  }
  if (config.metastore?.namespace) {
    publicationTemplate.metastoreNamespace = '{{ trigger.metadata.metastore.namespace }}';
  }

  const dashboardLookbackMinutes = Number(
    config.workflows.dashboard?.lookbackMinutes ?? process.env.OBSERVATORY_DASHBOARD_LOOKBACK_MINUTES ?? 720
  );

  const dashboardMetadata = {
    filestore: {
      baseUrl: config.filestore.baseUrl,
      backendMountId: config.filestore.backendMountId,
      token: config.filestore.token ?? null,
      reportsPrefix: config.filestore.reportsPrefix ?? 'datasets/observatory/reports',
      overviewPrefix:
        config.workflows.dashboard?.overviewPrefix ??
        config.filestore.reportsPrefix?.concat('/overview') ??
        'datasets/observatory/reports/overview',
      principal: 'observatory-dashboard-aggregator',
      calibrationsPrefix: config.filestore.calibrationsPrefix,
      plansPrefix: config.filestore.plansPrefix ?? null
    },
    timestore: {
      baseUrl: config.timestore.baseUrl,
      datasetSlug: config.timestore.datasetSlug,
      authToken: config.timestore.authToken ?? null
    },
    dashboard: {
      lookbackMinutes: dashboardLookbackMinutes
    }
  } satisfies Record<string, unknown>;

  const calibrationNamespace =
    config.metastore?.namespace && config.metastore.namespace !== 'observatory.reports'
      ? config.metastore.namespace
      : 'observatory.calibrations';

  const calibrationMetadata = {
    filestore: {
      baseUrl: config.filestore.baseUrl,
      backendMountId: config.filestore.backendMountId,
      token: config.filestore.token ?? null,
      principal: 'observatory-calibration-importer'
    },
    metastore: {
      baseUrl: config.metastore?.baseUrl ?? 'http://127.0.0.1:4100',
      namespace: calibrationNamespace,
      authToken: config.metastore?.authToken ?? null
    },
    calibrations: {
      prefix: config.filestore.calibrationsPrefix,
      plansPrefix: config.filestore.plansPrefix ?? null
    },
    catalog: {
      baseUrl: config.catalog?.baseUrl ?? 'http://127.0.0.1:4000',
      apiToken: config.catalog?.apiToken ?? null
    }
  } satisfies Record<string, unknown>;

  const calibrationTemplate: Record<string, unknown> = {
    filestoreBaseUrl: '{{ trigger.metadata.filestore.baseUrl }}',
    filestoreBackendId: '{{ trigger.metadata.filestore.backendMountId }}',
    filestoreToken: '{{ trigger.metadata.filestore.token }}',
    filestorePrincipal: '{{ trigger.metadata.filestore.principal }}',
    calibrationPath: '{{ event.payload.path }}',
    calibrationNodeId: '{{ event.payload.node.id }}',
    calibrationsPrefix: '{{ trigger.metadata.calibrations.prefix }}',
    plansPrefix: '{{ trigger.metadata.calibrations.plansPrefix }}',
    catalogBaseUrl: '{{ trigger.metadata.catalog.baseUrl }}',
    catalogApiToken: '{{ trigger.metadata.catalog.apiToken }}',
    checksum: '{{ event.payload.node.checksum }}',
    metastoreBaseUrl: '{{ trigger.metadata.metastore.baseUrl }}',
    metastoreNamespace: '{{ trigger.metadata.metastore.namespace }}',
    metastoreAuthToken: '{{ trigger.metadata.metastore.authToken }}'
  };

  const dashboardTemplate: Record<string, unknown> = {
    partitionKey:
      '{{ event.payload.partitionKeyFields.window | default: event.payload.partitionKey }}',
    filestoreBaseUrl: '{{ trigger.metadata.filestore.baseUrl }}',
    filestoreBackendId: '{{ trigger.metadata.filestore.backendMountId }}',
    reportsPrefix: '{{ trigger.metadata.filestore.reportsPrefix }}',
    overviewPrefix: '{{ trigger.metadata.filestore.overviewPrefix }}',
    lookbackMinutes: '{{ trigger.metadata.dashboard.lookbackMinutes }}',
    timestoreBaseUrl: '{{ trigger.metadata.timestore.baseUrl }}',
    timestoreDatasetSlug: '{{ trigger.metadata.timestore.datasetSlug }}'
  };

  if (config.timestore.authToken) {
    dashboardTemplate.timestoreAuthToken = '{{ trigger.metadata.timestore.authToken }}';
  }
  if (config.filestore.token) {
    dashboardTemplate.filestoreToken = '{{ trigger.metadata.filestore.token }}';
  }
  dashboardTemplate.filestorePrincipal = '{{ trigger.metadata.filestore.principal }}';

  const dashboardFallbackTemplate: Record<string, unknown> = {
    partitionKey: '{{ event.payload.partitionKeyFields.window | default: event.payload.minute }}',
    filestoreBaseUrl: '{{ trigger.metadata.filestore.baseUrl }}',
    filestoreBackendId: '{{ trigger.metadata.filestore.backendMountId }}',
    reportsPrefix: '{{ trigger.metadata.filestore.reportsPrefix }}',
    overviewPrefix: '{{ trigger.metadata.filestore.overviewPrefix }}',
    lookbackMinutes: '{{ trigger.metadata.dashboard.lookbackMinutes }}',
    timestoreBaseUrl: '{{ trigger.metadata.timestore.baseUrl }}',
    timestoreDatasetSlug: '{{ trigger.metadata.timestore.datasetSlug }}'
  };
  if (config.timestore.authToken) {
    dashboardFallbackTemplate.timestoreAuthToken = '{{ trigger.metadata.timestore.authToken }}';
  }
  if (config.filestore.token) {
    dashboardFallbackTemplate.filestoreToken = '{{ trigger.metadata.filestore.token }}';
  }
  dashboardFallbackTemplate.filestorePrincipal = '{{ trigger.metadata.filestore.principal }}';

  if (!config.workflows.aggregateSlug) {
    throw new Error('Aggregate workflow slug missing in observatory config');
  }

  const calibrationWorkflowSlug = config.workflows.calibrationImportSlug ?? 'observatory-calibration-import';

  const triggers: TriggerDefinition[] = [
    {
      workflowSlug: config.workflows.ingestSlug,
      name: 'Observatory ingest on filestore upload',
      description: 'Launch minute ingest when new CSV uploads land in the observatory inbox prefix.',
      eventType: 'filestore.command.completed',
      eventSource: 'filestore.service',
      predicates: [
        { path: '$.payload.command', operator: 'equals', value: 'uploadFile' },
        { path: '$.payload.backendMountId', operator: 'equals', value: config.filestore.backendMountId }
      ],
      parameterTemplate: ingestTemplate,
      metadata: ingestMetadata,
      throttleWindowMs: null,
      throttleCount: null,
      maxConcurrency: null,
      idempotencyKeyExpression: '{{ event.payload.node.metadata.minute }}-{{ event.payload.path | replace: "/", "_" | replace: ":", "-" }}'
    },
    {
      workflowSlug: config.workflows.publicationSlug,
      name: 'Observatory publication on observatory partition',
      description: 'Render plots and reports when the ingest job publishes a partition-ready event.',
      eventType: 'observatory.minute.partition-ready',
      eventSource: 'observatory.timestore-loader',
      predicates: [
        { path: '$.payload.datasetSlug', operator: 'equals', value: config.timestore.datasetSlug }
      ],
      parameterTemplate: publicationTemplate,
      metadata: publicationMetadata,
      throttleWindowMs: null,
      throttleCount: null,
      maxConcurrency: null,
      idempotencyKeyExpression:
        '{{ event.payload.instrumentId | default: "unknown" }}-{{ event.payload.partitionKey }}',
      runKeyTemplate:
        'observatory-publish-{{ parameters.instrumentId | replace: ":", "-" }}-{{ parameters.partitionKey | replace: ":", "-" }}'
    },
    {
      workflowSlug: config.workflows.aggregateSlug,
      name: 'Observatory dashboard aggregate',
      description: 'Refresh the aggregate dashboard after each partition is ready.',
      eventType: 'timestore.partition.created',
      eventSource: 'timestore.ingest',
      predicates: [
        { path: '$.payload.datasetSlug', operator: 'equals', value: config.timestore.datasetSlug }
      ],
      parameterTemplate: dashboardTemplate,
      metadata: dashboardMetadata,
      throttleWindowMs: 0,
      throttleCount: null,
      maxConcurrency: 1,
      idempotencyKeyExpression:
        'observatory-dashboard-{{ event.payload.partitionKeyFields.window | default: event.payload.partitionKey }}',
      runKeyTemplate: 'observatory-dashboard-{{ parameters.partitionKey | replace: ":", "-" }}'
    },
    {
      workflowSlug: config.workflows.aggregateSlug,
      name: 'Observatory dashboard aggregate (fallback)',
      description: 'Fallback trigger to refresh dashboards immediately after ingest runs.',
      eventType: 'observatory.minute.partition-ready',
      eventSource: 'observatory.timestore-loader',
      predicates: [
        { path: '$.payload.datasetSlug', operator: 'equals', value: config.timestore.datasetSlug }
      ],
      parameterTemplate: dashboardFallbackTemplate,
      metadata: dashboardMetadata,
      throttleWindowMs: 0,
      throttleCount: null,
      maxConcurrency: 1,
      idempotencyKeyExpression:
        'observatory-dashboard-{{ event.payload.partitionKeyFields.window | default: event.payload.minute }}',
      runKeyTemplate: 'observatory-dashboard-{{ parameters.partitionKey | replace: ":", "-" }}'
    },
    {
      workflowSlug: calibrationWorkflowSlug,
      name: 'Observatory calibration import',
      description: 'Process calibration uploads from the observatory calibrations prefix.',
      eventType: 'filestore.command.completed',
      eventSource: 'filestore.service',
      predicates: [
        { path: '$.payload.command', operator: 'equals', value: 'uploadFile' },
        { path: '$.payload.backendMountId', operator: 'equals', value: config.filestore.backendMountId }
      ],
      parameterTemplate: calibrationTemplate,
      metadata: calibrationMetadata,
      throttleWindowMs: null,
      throttleCount: null,
      maxConcurrency: null,
      idempotencyKeyExpression:
        'observatory-calibration-{{ event.payload.node.id | default: event.payload.path | replace: "/", "_" | replace: ":", "-" }}',
      runKeyTemplate:
        'observatory-calibration-{{ event.payload.node.id | default: event.payload.path | replace: "/", "-" | replace: ":", "-" }}'
    }
  ];

  for (const trigger of triggers) {
    await ensureTrigger(catalogBaseUrl, catalogToken, trigger);
  }

  console.log('Workflow event triggers applied successfully.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
