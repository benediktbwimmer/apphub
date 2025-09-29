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
        idempotencyKeyExpression: definition.idempotencyKeyExpression
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
      idempotencyKeyExpression: definition.idempotencyKeyExpression
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
    paths: {
      stagingDir: config.paths.staging,
      archiveDir: config.paths.archive
    },
    filestore: {
      baseUrl: config.filestore.baseUrl,
      backendMountId: config.filestore.backendMountId,
      token: config.filestore.token ?? null,
      inboxPrefix: config.filestore.inboxPrefix,
      stagingPrefix: config.filestore.stagingPrefix,
      archivePrefix: config.filestore.archivePrefix,
      principal: 'observatory-inbox-normalizer'
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

  const ingestTemplate: Record<string, unknown> = {
    minute: '{{ event.payload.node.metadata.minute }}',
    maxFiles: '{{ trigger.metadata.maxFiles }}',
    stagingDir: '{{ trigger.metadata.paths.stagingDir }}',
    archiveDir: '{{ trigger.metadata.paths.archiveDir }}',
    filestoreBaseUrl: '{{ trigger.metadata.filestore.baseUrl }}',
    filestoreBackendId: '{{ trigger.metadata.filestore.backendMountId }}',
    inboxPrefix: '{{ trigger.metadata.filestore.inboxPrefix }}',
    stagingPrefix: '{{ trigger.metadata.filestore.stagingPrefix }}',
    archivePrefix: '{{ trigger.metadata.filestore.archivePrefix }}',
    commandPath: '{{ event.payload.path }}',
    filestorePrincipal: '{{ trigger.metadata.filestore.principal }}',
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

  const publicationMetadata = {
    timestore: {
      baseUrl: config.timestore.baseUrl,
      datasetSlug: config.timestore.datasetSlug,
      authToken: config.timestore.authToken ?? null
    },
    paths: {
      plotsDir: config.paths.plots,
      reportsDir: config.paths.reports
    },
    metastore: {
      baseUrl: config.metastore?.baseUrl ?? null,
      namespace: config.metastore?.namespace ?? null,
      authToken: config.metastore?.authToken ?? null
    }
  } satisfies Record<string, unknown>;

  const publicationTemplate: Record<string, unknown> = {
    partitionKey: '{{ event.payload.partitionKey.window | default: event.payload.partitionKey }}',
    timestoreBaseUrl: '{{ trigger.metadata.timestore.baseUrl }}',
    timestoreDatasetSlug: '{{ trigger.metadata.timestore.datasetSlug }}',
    plotsDir: '{{ trigger.metadata.paths.plotsDir }}',
    reportsDir: '{{ trigger.metadata.paths.reportsDir }}'
  };

  if (config.timestore.authToken) {
    publicationTemplate.timestoreAuthToken = '{{ trigger.metadata.timestore.authToken }}';
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
      idempotencyKeyExpression: '{{ event.payload.node.metadata.minute }}'
    },
    {
      workflowSlug: config.workflows.publicationSlug,
      name: 'Observatory publication on timestore partition',
      description: 'Render plots and reports whenever a new observatory partition is ingested into Timestore.',
      eventType: 'timestore.partition.created',
      eventSource: 'timestore.ingest',
      predicates: [
        { path: '$.payload.datasetSlug', operator: 'equals', value: config.timestore.datasetSlug }
      ],
      parameterTemplate: publicationTemplate,
      metadata: publicationMetadata,
      throttleWindowMs: null,
      throttleCount: null,
      maxConcurrency: null,
      idempotencyKeyExpression: '{{ event.payload.partitionKey.window | default: event.payload.partitionKey }}'
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
