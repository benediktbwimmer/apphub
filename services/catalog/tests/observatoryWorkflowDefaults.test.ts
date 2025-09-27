import './setupTestEnv';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowDefinitionTemplate } from '@apphub/examples-registry';
import { bootstrapPlanSchema, executeBootstrapPlan } from '../src/bootstrap';

async function loadWorkflow(slug: string): Promise<WorkflowDefinitionTemplate> {
  const workflowPath = path.resolve(
    process.cwd(),
    'examples',
    'environmental-observatory-event-driven',
    'workflows',
    `${slug}.json`
  );
  const contents = await readFile(workflowPath, 'utf8');
  return JSON.parse(contents) as WorkflowDefinitionCreateInput;
}

async function run(): Promise<void> {
  const config = {
    paths: {
      inbox: '/tmp/observatory/inbox',
      staging: '/tmp/observatory/staging',
      archive: '/tmp/observatory/archive',
      plots: '/tmp/observatory/plots',
      reports: '/tmp/observatory/reports'
    },
    filestore: {
      baseUrl: 'http://filestore.local',
      backendMountId: 42,
      token: 'filestore-token',
      inboxPrefix: 'datasets/custom/inbox',
      stagingPrefix: 'datasets/custom/staging',
      archivePrefix: 'datasets/custom/archive'
    },
    timestore: {
      baseUrl: 'http://timestore.local',
      datasetSlug: 'observatory-overrides',
      datasetName: 'Observatory Overrides',
      tableName: 'observations_custom',
      storageTargetId: 'target-99',
      authToken: 'timestore-token'
    },
    metastore: {
      baseUrl: 'http://metastore.local',
      namespace: 'observatory.custom',
      authToken: 'metastore-token'
    },
    workflows: {
      ingestSlug: 'observatory-minute-ingest',
      publicationSlug: 'observatory-daily-publication',
      visualizationAssetId: 'observatory.visualizations.custom'
    }
  } as const;

  const placeholderValues = new Map<string, string>([
    ['OBSERVATORY_DATA_ROOT', path.dirname(config.paths.staging)]
  ]);

  const envOverrides: Record<string, string> = {
    OBSERVATORY_FILESTORE_BASE_URL: config.filestore.baseUrl,
    OBSERVATORY_FILESTORE_BACKEND_ID: String(config.filestore.backendMountId),
    OBSERVATORY_FILESTORE_TOKEN: config.filestore.token ?? '',
    OBSERVATORY_FILESTORE_INBOX_PREFIX: config.filestore.inboxPrefix,
    OBSERVATORY_FILESTORE_STAGING_PREFIX: config.filestore.stagingPrefix,
    OBSERVATORY_FILESTORE_ARCHIVE_PREFIX: config.filestore.archivePrefix,
    OBSERVATORY_TIMESTORE_BASE_URL: config.timestore.baseUrl,
    OBSERVATORY_TIMESTORE_DATASET_SLUG: config.timestore.datasetSlug,
    OBSERVATORY_TIMESTORE_DATASET_NAME: config.timestore.datasetName ?? '',
    OBSERVATORY_TIMESTORE_TABLE_NAME: config.timestore.tableName ?? '',
    OBSERVATORY_TIMESTORE_STORAGE_TARGET_ID: config.timestore.storageTargetId ?? '',
    OBSERVATORY_TIMESTORE_TOKEN: config.timestore.authToken ?? '',
    OBSERVATORY_METASTORE_BASE_URL: config.metastore?.baseUrl ?? '',
    OBSERVATORY_METASTORE_NAMESPACE: config.metastore?.namespace ?? '',
    OBSERVATORY_METASTORE_TOKEN: config.metastore?.authToken ?? '',
    OBSERVATORY_CATALOG_BASE_URL: config.catalog?.baseUrl ?? '',
    OBSERVATORY_CATALOG_TOKEN: config.catalog?.apiToken ?? '',
    OBSERVATORY_INGEST_WORKFLOW_SLUG: config.workflows.ingestSlug,
    OBSERVATORY_PUBLICATION_WORKFLOW_SLUG: config.workflows.publicationSlug,
    OBSERVATORY_VISUALIZATION_ASSET_ID: config.workflows.visualizationAssetId
  };

  const originalEnv = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(envOverrides)) {
    originalEnv.set(key, process.env[key]);
    process.env[key] = value;
  }

  const serviceConfigPath = path.resolve(
    process.cwd(),
    'examples',
    'environmental-observatory-event-driven',
    'service-manifests',
    'service-config.json'
  );
  const configContents = await readFile(serviceConfigPath, 'utf8');
  const serviceConfig = JSON.parse(configContents) as { bootstrap?: unknown; module: string };
  const bootstrapPlan = serviceConfig.bootstrap
    ? bootstrapPlanSchema.parse(serviceConfig.bootstrap)
    : { actions: [] };

  const workflowPlan = {
    actions: bootstrapPlan.actions.filter((action) => action.type === 'applyWorkflowDefaults')
  };

  let bootstrapResult: Awaited<ReturnType<typeof executeBootstrapPlan>>;
  try {
    bootstrapResult = await executeBootstrapPlan({
      moduleId: serviceConfig.module,
      plan: workflowPlan,
      placeholders: placeholderValues,
      variables: { ...Object.fromEntries(placeholderValues), ...envOverrides },
      workspaceRoot: process.cwd()
    });
  } finally {
    for (const [key, value] of originalEnv.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }

  assert(bootstrapResult, 'bootstrap execution should produce a result');

  const defaultsBySlug = bootstrapResult.workflowDefaults;

  const generatorDefaults = defaultsBySlug.get('observatory-minute-data-generator');
  assert(generatorDefaults, 'generator defaults should be registered');
  const generator = await loadWorkflow('observatory-minute-data-generator');
  mergeDefaultParameters(generator, generatorDefaults);
  assert(!('inboxDir' in (generator.defaultParameters ?? {})));
  assert.equal(generator.defaultParameters?.filestoreBaseUrl, config.filestore.baseUrl);
  assert.equal(generator.defaultParameters?.filestoreBackendId, config.filestore.backendMountId);
  assert.equal(generator.defaultParameters?.filestoreToken, config.filestore.token);

  const ingestDefaults = defaultsBySlug.get('observatory-minute-ingest');
  assert(ingestDefaults, 'ingest defaults should be registered');
  const ingest = await loadWorkflow('observatory-minute-ingest');
  mergeDefaultParameters(ingest, ingestDefaults);
  assert.equal(ingest.defaultParameters?.stagingDir, config.paths.staging);
  assert.equal(ingest.defaultParameters?.archiveDir, config.paths.archive);
  assert.equal(ingest.defaultParameters?.timestoreDatasetSlug, config.timestore.datasetSlug);
  assert.equal(ingest.defaultParameters?.timestoreStorageTargetId, config.timestore.storageTargetId);
  assert.equal(ingest.defaultParameters?.timestoreAuthToken, config.timestore.authToken);

  const publicationDefaults = defaultsBySlug.get('observatory-daily-publication');
  assert(publicationDefaults, 'publication defaults should be registered');
  const publication = await loadWorkflow('observatory-daily-publication');
  mergeDefaultParameters(publication, publicationDefaults);
  assert.equal(publication.defaultParameters?.plotsDir, config.paths.plots);
  assert.equal(publication.defaultParameters?.reportsDir, config.paths.reports);
  assert.equal(publication.defaultParameters?.metastoreBaseUrl, config.metastore?.baseUrl);
  assert.equal(publication.defaultParameters?.metastoreNamespace, config.metastore?.namespace);
  assert.equal(publication.defaultParameters?.metastoreAuthToken, config.metastore?.authToken);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
function mergeDefaultParameters(
  definition: WorkflowDefinitionTemplate,
  defaults: Record<string, unknown>
): void {
  const existing =
    definition.defaultParameters &&
    typeof definition.defaultParameters === 'object' &&
    !Array.isArray(definition.defaultParameters)
      ? { ...(definition.defaultParameters as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(defaults)) {
    existing[key] = value;
  }
  definition.defaultParameters = existing;
}
