import assert from 'node:assert/strict';
import '@apphub/catalog-tests/setupTestEnv';
import { enumeratePartitionKeys } from '@apphub/catalog/workflows/partitioning';
import {
  jobDefinitionCreateSchema,
  workflowDefinitionCreateSchema
} from '@apphub/catalog/workflows/zodSchemas';
import {
  loadExampleJobDefinition,
  loadExampleWorkflowDefinition
} from '../helpers/examples';

const environmentalObservatoryJobs = [
  'observatory-inbox-normalizer',
  'observatory-duckdb-loader',
  'observatory-visualization-runner',
  'observatory-report-publisher'
].map(loadExampleJobDefinition);

const observatoryHourlyIngestWorkflow = loadExampleWorkflowDefinition('observatory-hourly-ingest');
const observatoryDailyPublicationWorkflow = loadExampleWorkflowDefinition('observatory-daily-publication');

(async function run() {
  for (const job of environmentalObservatoryJobs) {
    const parsed = jobDefinitionCreateSchema.parse(job);
    assert.ok(parsed.slug.startsWith('observatory-'));
  }

  const ingest = workflowDefinitionCreateSchema.parse(observatoryHourlyIngestWorkflow);
  const publication = workflowDefinitionCreateSchema.parse(observatoryDailyPublicationWorkflow);

  assert.equal(ingest.steps.length, 2);
  assert.equal(publication.steps.length, 2);

  const rawAsset = ingest.steps[0]?.produces?.[0];
  assert.ok(rawAsset?.partitioning);
  assert.equal(rawAsset?.assetId, 'observatory.timeseries.raw');
  assert.equal(rawAsset?.partitioning?.type, 'timeWindow');

  const rawPartitions = enumeratePartitionKeys(rawAsset!.partitioning!, {
    now: new Date('2025-08-01T12:15:00Z'),
    lookback: 2
  });
  assert.ok(rawPartitions.includes('2025-08-01T12'));

  const duckdbAsset = ingest.steps[1]?.produces?.[0];
  assert.ok(duckdbAsset?.freshness?.ttlMs);
  assert.equal(duckdbAsset?.autoMaterialize?.onUpstreamUpdate, true);

  const visualizationStep = publication.steps[0];
  assert.ok(visualizationStep?.consumes?.some((entry) => entry.assetId === 'observatory.timeseries.duckdb'));
  const visualizationAsset = visualizationStep?.produces?.[0];
  assert.equal(visualizationAsset?.autoMaterialize?.onUpstreamUpdate, true);

  const reportStep = publication.steps[1];
  assert.ok(reportStep?.consumes?.some((entry) => entry.assetId === 'observatory.visualizations.hourly'));
  const reportAsset = reportStep?.produces?.[0];
  assert.equal(reportAsset?.autoMaterialize?.onUpstreamUpdate, true);
  assert.equal(reportStep?.parameters?.visualizationAsset, '{{ shared.visualizations }}');
})();
