import './setupTestEnv';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  applyObservatoryWorkflowDefaults,
  type EventDrivenObservatoryConfig,
  type WorkflowDefinitionTemplate
} from '@apphub/examples-registry';

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
  const config: EventDrivenObservatoryConfig = {
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
  };

  const generator = await loadWorkflow('observatory-minute-data-generator');
  applyObservatoryWorkflowDefaults(generator, config);
  assert.equal(generator.defaultParameters?.inboxDir, config.paths.inbox);
  assert.equal(generator.defaultParameters?.filestoreBaseUrl, config.filestore.baseUrl);
  assert.equal(generator.defaultParameters?.filestoreBackendId, config.filestore.backendMountId);
  assert.equal(generator.defaultParameters?.filestoreToken, config.filestore.token);

  const ingest = await loadWorkflow('observatory-minute-ingest');
  applyObservatoryWorkflowDefaults(ingest, config);
  assert.equal(ingest.defaultParameters?.stagingDir, config.paths.staging);
  assert.equal(ingest.defaultParameters?.archiveDir, config.paths.archive);
  assert.equal(ingest.defaultParameters?.timestoreDatasetSlug, config.timestore.datasetSlug);
  assert.equal(ingest.defaultParameters?.timestoreStorageTargetId, config.timestore.storageTargetId);
  assert.equal(ingest.defaultParameters?.timestoreAuthToken, config.timestore.authToken);

  const publication = await loadWorkflow('observatory-daily-publication');
  applyObservatoryWorkflowDefaults(publication, config);
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
