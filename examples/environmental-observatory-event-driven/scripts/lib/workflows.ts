import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fetch } from 'undici';
import {
  applyObservatoryWorkflowDefaults,
  type EventDrivenObservatoryConfig,
  type WorkflowDefinitionTemplate
} from '@apphub/examples';

export type SyncLogger = {
  info?: (message: string, meta?: Record<string, unknown>) => void;
  warn?: (message: string, meta?: Record<string, unknown>) => void;
  error?: (message: string, meta?: Record<string, unknown>) => void;
};

type TriggerDefinition = {
  workflowSlug: string;
  name: string;
  description: string;
  eventType: string;
  eventSource?: string | null;
  maxConcurrency?: number | null;
  throttleWindowMs?: number | null;
  throttleCount?: number | null;
  predicates: Array<{
    path: string;
    operator: 'equals' | 'notEquals' | 'in' | 'notIn' | 'exists';
    value?: unknown;
    values?: unknown[];
  }>;
  parameterTemplate: Record<string, unknown>;
  metadata: Record<string, unknown>;
  idempotencyKeyExpression?: string;
  runKeyTemplate?: string;
};

type RequestMethod = 'GET' | 'POST' | 'PATCH';

async function request<T>(
  baseUrl: string,
  token: string,
  method: RequestMethod,
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
    throw new Error(`Core request failed (${response.status}): ${text}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function getWorkflow(baseUrl: string, token: string, slug: string): Promise<unknown | null> {
  const response = await fetch(new URL(`/workflows/${slug}`, baseUrl), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Core request failed (${response.status}): ${text}`);
  }

  return response.json();
}

export async function ensureWorkflow(
  baseUrl: string,
  token: string,
  slug: string,
  config: EventDrivenObservatoryConfig,
  repoRoot: string,
  logger: SyncLogger,
  options: { omitProvisioningSchedules?: boolean } = {}
): Promise<void> {
  const workflowFiles: Record<string, string> = {
    'observatory-minute-data-generator': 'workflows/observatory-minute-data-generator.json',
    'observatory-minute-ingest': 'workflows/observatory-minute-ingest.json',
    'observatory-daily-publication': 'workflows/observatory-daily-publication.json',
    'observatory-dashboard-aggregate': 'workflows/observatory-dashboard-aggregate.json',
    'observatory-calibration-import': 'workflows/observatory-calibration-import.json',
    'observatory-calibration-reprocess': 'workflows/observatory-calibration-reprocess.json'
  } as const;

  const relativePath = workflowFiles[slug];
  if (!relativePath) {
    logger.warn?.('Skipping unrecognized workflow slug', { slug });
    return;
  }

  const absolutePath = path.resolve(repoRoot, relativePath);
  const contents = await readFile(absolutePath, 'utf8');
  const definition = JSON.parse(contents) as WorkflowDefinitionTemplate;
  applyObservatoryWorkflowDefaults(definition, config);

  if (options.omitProvisioningSchedules && definition.metadata?.provisioning?.schedules) {
    definition.metadata.provisioning.schedules = [];
  }

  const existing = await getWorkflow(baseUrl, token, slug);
  if (!existing) {
    await request(baseUrl, token, 'POST', '/workflows', definition);
    logger.info?.('Created workflow', { slug });
    return;
  }

  await request(baseUrl, token, 'PATCH', `/workflows/${slug}`, {
    defaultParameters: definition.defaultParameters,
    metadata: definition.metadata ?? null
  });
  logger.info?.('Updated workflow defaults', { slug });
}

type TriggerRecord = {
  id: string;
  name: string | null;
};

async function ensureTrigger(
  baseUrl: string,
  token: string,
  definition: TriggerDefinition,
  logger: SyncLogger
): Promise<void> {
  const existingResponse = await request<{ data: TriggerRecord[] | { triggers?: TriggerRecord[] } }>(
    baseUrl,
    token,
    'GET',
    `/workflows/${definition.workflowSlug}/triggers`
  );

  const data = existingResponse.data as TriggerRecord[] | { triggers?: TriggerRecord[] };
  const triggerList = Array.isArray(data)
    ? data
    : Array.isArray(data.triggers)
      ? data.triggers
      : [];

  const current = triggerList.find((entry) => entry.name === definition.name);
  const payload = {
    name: definition.name,
    description: definition.description,
    eventType: definition.eventType,
    eventSource: definition.eventSource ?? undefined,
    predicates: definition.predicates,
    parameterTemplate: definition.parameterTemplate,
    metadata: definition.metadata,
    idempotencyKeyExpression: definition.idempotencyKeyExpression,
    runKeyTemplate: definition.runKeyTemplate,
    maxConcurrency: definition.maxConcurrency ?? null,
    throttleWindowMs: definition.throttleWindowMs ?? null,
    throttleCount: definition.throttleCount ?? null
  } as const;

  if (current) {
    await request(baseUrl, token, 'PATCH', `/workflows/${definition.workflowSlug}/triggers/${current.id}`, payload);
    logger.info?.('Updated trigger', { workflow: definition.workflowSlug, name: definition.name });
    return;
  }

  await request(baseUrl, token, 'POST', `/workflows/${definition.workflowSlug}/triggers`, payload);
  logger.info?.('Created trigger', { workflow: definition.workflowSlug, name: definition.name });
}

function buildTriggerDefinitions(config: EventDrivenObservatoryConfig): TriggerDefinition[] {
  const ingestMetadata: Record<string, unknown> = {
    maxFiles: 1000,
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
    namespace: config.metastore?.namespace ?? 'observatory.calibrations',
    authToken: config.metastore?.authToken ?? null
  } satisfies Record<string, unknown>;

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
      overviewPrefix:
        config.workflows.dashboard?.overviewPrefix ??
        `${config.filestore.reportsPrefix ?? 'datasets/observatory/reports'}/overview`
    },
    lookbackMinutes: config.workflows.dashboard?.lookbackMinutes ?? 720
  };

  return [
    {
      workflowSlug: config.workflows.ingestSlug,
      name: 'observatory-minute.raw-uploaded',
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
        },
        {
          path: '$.payload.node.metadata.minute',
          operator: 'exists'
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
      metadata: ingestMetadata
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
        filestoreBackendId: config.filestore.backendMountId,
        filestoreToken: config.filestore.token ?? null,
        filestorePrincipal: 'observatory-visualization-runner',
        visualizationsPrefix:
          config.filestore.visualizationsPrefix ?? 'datasets/observatory/visualizations',
        reportsPrefix: config.filestore.reportsPrefix ?? 'datasets/observatory/reports'
      },
      metadata: publicationMetadata,
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
        filestoreBackendId: config.filestore.backendMountId,
        filestoreToken: config.filestore.token ?? null,
        filestorePrincipal: 'observatory-dashboard-aggregator',
        reportsPrefix: config.filestore.reportsPrefix ?? 'datasets/observatory/reports',
        overviewPrefix:
          config.workflows.dashboard?.overviewPrefix ??
          `${config.filestore.reportsPrefix ?? 'datasets/observatory/reports'}/overview`,
        lookbackMinutes: config.workflows.dashboard?.lookbackMinutes ?? 720
      },
      metadata: aggregateMetadata,
      runKeyTemplate: '{{ trigger.payload.partitionKey }}'
    }
  ];
}

function resolveWorkflowSlugs(config: EventDrivenObservatoryConfig): Set<string> {
  const slugs = new Set<string>();
  if (config.workflows.generatorSlug) {
    slugs.add(config.workflows.generatorSlug);
  }
  slugs.add(config.workflows.ingestSlug);
  slugs.add(config.workflows.publicationSlug);
  if (config.workflows.aggregateSlug) {
    slugs.add(config.workflows.aggregateSlug);
  }
  if (config.workflows.calibrationImportSlug) {
    slugs.add(config.workflows.calibrationImportSlug);
  }
  const reprocessSlug =
    config.workflows.reprocessSlug && config.workflows.reprocessSlug.trim().length > 0
      ? config.workflows.reprocessSlug
      : 'observatory-calibration-reprocess';
  slugs.add(reprocessSlug);
  return slugs;
}

export async function synchronizeObservatoryWorkflowsAndTriggers(
  options: {
    config: EventDrivenObservatoryConfig;
    coreBaseUrl?: string;
    coreToken: string;
    repoRoot?: string;
    logger?: SyncLogger;
    omitGeneratorSchedule?: boolean;
  }
): Promise<void> {
  const { config, logger = {} } = options;
  const coreBaseUrl = (options.coreBaseUrl ?? config.core?.baseUrl ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
  const coreToken = options.coreToken;
  if (!coreToken) {
    throw new Error('Core API token missing. Set core.apiToken in the observatory config.');
  }

  const repoRoot = options.repoRoot ?? path.resolve(__dirname, '..', '..');
  const workflowDir = path.resolve(repoRoot, 'workflows');
  const absoluteRepo = path.resolve(workflowDir, '..');
  const generatorSlug = config.workflows.generatorSlug?.trim() || 'observatory-minute-data-generator';

  for (const slug of resolveWorkflowSlugs(config)) {
    const omitProvisioningSchedules = options.omitGeneratorSchedule === true && slug === generatorSlug;
    await ensureWorkflow(coreBaseUrl, coreToken, slug, config, absoluteRepo, logger, {
      omitProvisioningSchedules
    });
  }

  const triggers = buildTriggerDefinitions(config);
  for (const trigger of triggers) {
    await ensureTrigger(coreBaseUrl, coreToken, trigger, logger);
  }
}
