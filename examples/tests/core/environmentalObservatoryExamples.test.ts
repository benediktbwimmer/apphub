import assert from 'node:assert/strict';
import '@apphub/core-tests/setupTestEnv';
import { enumeratePartitionKeys } from '@apphub/core/workflows/partitioning';
import { workflowDefinitionCreateSchema } from '@apphub/core/workflows/zodSchemas';
import { loadModuleWorkflowDefinition } from '../helpers/modules';
import type { ModuleWorkflowSlug } from '@apphub/module-registry';

const observatoryWorkflowSlugs: ModuleWorkflowSlug[] = [
  'observatory-minute-data-generator',
  'observatory-minute-ingest',
  'observatory-daily-publication'
];
(async function run() {
  const [
    observatoryMinuteDataGeneratorWorkflow,
    observatoryMinuteIngestWorkflow,
    observatoryDailyPublicationWorkflow
  ] = await Promise.all(observatoryWorkflowSlugs.map((slug) => loadModuleWorkflowDefinition(slug)));

  const generator = workflowDefinitionCreateSchema.parse(observatoryMinuteDataGeneratorWorkflow);
  const ingest = workflowDefinitionCreateSchema.parse(observatoryMinuteIngestWorkflow);
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
  assert.equal(generatorAsset?.partitioning?.granularity, 'minute');

  const rawAsset = ingest.steps[0]?.produces?.[0];
  assert.ok(rawAsset?.partitioning);
  assert.equal(rawAsset?.assetId, 'observatory.timeseries.raw');
  assert.equal(rawAsset?.partitioning?.type, 'timeWindow');
  assert.equal(ingest.steps[0]?.parameters?.archiveDir, '{{ parameters.archiveDir }}');

  const rawPartitions = enumeratePartitionKeys(rawAsset!.partitioning!, {
    now: new Date('2025-08-01T12:15:00Z'),
    lookback: 2
  });
  assert.ok(rawPartitions.includes('2025-08-01T12:15'));

  const timestoreAsset = ingest.steps[1]?.produces?.[0];
  assert.ok(timestoreAsset?.freshness?.ttlMs);
  assert.equal(timestoreAsset?.autoMaterialize?.onUpstreamUpdate, true);
  assert.equal(ingest.steps[1]?.parameters?.timestoreBaseUrl, '{{ parameters.timestoreBaseUrl }}');
  assert.equal(ingest.steps[1]?.parameters?.timestoreDatasetSlug, '{{ parameters.timestoreDatasetSlug }}');
  assert.equal(ingest.steps[1]?.parameters?.timestoreDatasetName, '{{ parameters.timestoreDatasetName }}');
  assert.equal(ingest.steps[1]?.parameters?.timestoreTableName, '{{ parameters.timestoreTableName }}');

  const visualizationStep = publication.steps[0];
  assert.ok(visualizationStep?.consumes?.some((entry) => entry.assetId === 'observatory.timeseries.timestore'));
  const visualizationAsset = visualizationStep?.produces?.[0];
  assert.equal(visualizationAsset?.autoMaterialize?.onUpstreamUpdate, true);

  const reportStep = publication.steps[1];
  assert.ok(reportStep?.consumes?.some((entry) => entry.assetId === 'observatory.visualizations.minute'));
  const reportAsset = reportStep?.produces?.[0];
  assert.equal(reportAsset?.autoMaterialize?.onUpstreamUpdate, true);
  assert.equal(reportStep?.parameters?.visualizationAsset, '{{ shared.visualizations.visualization }}');
})();
