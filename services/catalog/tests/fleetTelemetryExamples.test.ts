import assert from 'node:assert/strict';
import './setupTestEnv';
import { enumeratePartitionKeys } from '../src/workflows/partitioning';
import { jobDefinitionCreateSchema, workflowDefinitionCreateSchema } from '../src/workflows/zodSchemas';
import {
  fleetTelemetryJobs,
  fleetTelemetryDailyRollupWorkflow,
  fleetTelemetryAlertsWorkflow
} from '../src/workflows/examples/fleetTelemetryExamples';

(async function run() {
  for (const job of fleetTelemetryJobs) {
    const parsed = jobDefinitionCreateSchema.parse(job);
    assert.ok(parsed.slug.includes('telemetry') || parsed.slug.includes('alerts'));
  }

  const rollup = workflowDefinitionCreateSchema.parse(fleetTelemetryDailyRollupWorkflow);
  const alerts = workflowDefinitionCreateSchema.parse(fleetTelemetryAlertsWorkflow);

  assert.equal(rollup.steps.length, 1);
  assert.equal(alerts.steps.length, 1);
  assert.equal(rollup.defaultParameters?.outputDir, 'services/catalog/data/examples/fleet-telemetry-rollups');
  assert.equal(alerts.defaultParameters?.telemetryDir, 'services/catalog/data/examples/fleet-telemetry-rollups');

  const telemetryAsset = rollup.steps[0]?.produces?.[0];
  assert.ok(telemetryAsset?.partitioning);
  assert.equal(telemetryAsset?.partitioning?.type, 'dynamic');
  assert.equal(telemetryAsset?.assetId, 'greenhouse.telemetry.instrument');

  // Dynamic partitions are discovered at runtime and do not enumerate ahead of time.
  const partitionKeys = enumeratePartitionKeys(telemetryAsset!.partitioning!, { lookback: 5 });
  assert.equal(partitionKeys.length, 0);

  const alertsAsset = alerts.steps[0]?.produces?.[0];
  assert.ok(alertsAsset?.autoMaterialize);
  assert.equal(alertsAsset?.assetId, 'greenhouse.telemetry.alerts');
})();
