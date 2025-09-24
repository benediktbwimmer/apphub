import assert from 'node:assert/strict';
import './setupTestEnv';
import { enumeratePartitionKeys } from '../src/workflows/partitioning';
import { jobDefinitionCreateSchema, workflowDefinitionCreateSchema } from '../src/workflows/zodSchemas';
import {
  retailSalesJobs,
  retailSalesDailyIngestWorkflow,
  retailSalesInsightsWorkflow
} from '../src/workflows/examples/retailSalesExamples';

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
