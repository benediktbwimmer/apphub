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
import type { ExampleJobSlug, ExampleWorkflowSlug } from '@apphub/examples-registry';

const environmentalObservatoryJobSlugs: ExampleJobSlug[] = [
  'observatory-data-generator',
  'observatory-inbox-normalizer',
  'observatory-duckdb-loader',
  'observatory-visualization-runner',
  'observatory-report-publisher'
];
const environmentalObservatoryJobs = environmentalObservatoryJobSlugs.map(loadExampleJobDefinition);

const observatoryWorkflowSlugs: ExampleWorkflowSlug[] = [
  'observatory-hourly-data-generator',
  'observatory-hourly-ingest',
  'observatory-daily-publication'
];
const [
  observatoryHourlyDataGeneratorWorkflow,
  observatoryHourlyIngestWorkflow,
  observatoryDailyPublicationWorkflow
] = observatoryWorkflowSlugs.map(loadExampleWorkflowDefinition);

(async function run() {
  for (const job of environmentalObservatoryJobs) {
    const parsed = jobDefinitionCreateSchema.parse(job);
    assert.ok(parsed.slug.startsWith('observatory-'));
  }

  const generator = workflowDefinitionCreateSchema.parse(observatoryHourlyDataGeneratorWorkflow);
  const ingest = workflowDefinitionCreateSchema.parse(observatoryHourlyIngestWorkflow);
  const publication = workflowDefinitionCreateSchema.parse(observatoryDailyPublicationWorkflow);

  assert.equal(generator.steps.length, 1);
  assert.equal(ingest.steps.length, 2);
  assert.equal(publication.steps.length, 2);

  const generatorStep = generator.steps[0];
  assert.equal(generatorStep?.jobSlug, 'observatory-data-generator');
  const generatorAsset = generatorStep?.produces?.[0];
  assert.ok(generatorAsset?.partitioning);
  assert.equal(generatorAsset?.assetId, 'observatory.inbox.synthetic');
  assert.equal(generatorAsset?.partitioning?.type, 'timeWindow');
  assert.equal(generatorAsset?.partitioning?.granularity, 'hour');

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
