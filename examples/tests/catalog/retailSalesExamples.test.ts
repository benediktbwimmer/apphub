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
import type { ExampleJobSlug, ExampleWorkflowSlug } from '@apphub/examples';

const retailSalesJobSlugs: ExampleJobSlug[] = [
  'retail-sales-csv-loader',
  'retail-sales-parquet-builder',
  'retail-sales-visualizer'
];
const retailSalesJobs = retailSalesJobSlugs.map(loadExampleJobDefinition);

const retailSalesWorkflowSlugs: ExampleWorkflowSlug[] = [
  'retail-sales-daily-ingest',
  'retail-sales-insights'
];
const [retailSalesDailyIngestWorkflow, retailSalesInsightsWorkflow] = retailSalesWorkflowSlugs.map(
  loadExampleWorkflowDefinition
);

(async function run() {
  for (const job of retailSalesJobs) {
    const parsed = jobDefinitionCreateSchema.parse(job);
    assert.ok(parsed.slug.startsWith('retail-sales'));
  }

  const ingest = workflowDefinitionCreateSchema.parse(retailSalesDailyIngestWorkflow);
  const insights = workflowDefinitionCreateSchema.parse(retailSalesInsightsWorkflow);

  assert.equal(ingest.steps.length, 2);
  assert.equal(insights.steps.length, 1);

  const rawAsset = ingest.steps[0]?.produces?.[0];
  assert.ok(rawAsset);
  assert.equal(rawAsset?.partitioning?.type, 'timeWindow');

  const parquetAsset = ingest.steps[1]?.produces?.[0];
  assert.ok(parquetAsset?.partitioning);
  const partitioning = parquetAsset!.partitioning!;
  const partitionKeys = enumeratePartitionKeys(partitioning, {
    now: new Date('2024-01-05T12:00:00Z'),
    lookback: 3
  });
  assert.equal(partitionKeys.length, 3);
  assert.equal(partitionKeys[0], '2024-01-05');

  const reportAsset = insights.steps[0]?.produces?.[0];
  assert.ok(reportAsset?.autoMaterialize);
  assert.equal(reportAsset?.autoMaterialize?.onUpstreamUpdate, true);

  const consumes = insights.steps[0]?.consumes ?? [];
  assert.ok(consumes.some((entry) => entry.assetId === 'retail.sales.parquet'));
})();
