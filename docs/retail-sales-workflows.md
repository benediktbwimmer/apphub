# Retail Sales Workflow Examples

The retail sales examples demonstrate how to move from raw CSV exports to curated downstream assets using partitions and auto-materialization. Two workflows coordinate the process:

1. **`retail-sales-daily-ingest`** ingests daily CSV partitions, computes summary metrics, and persists Parquet artifacts.
2. **`retail-sales-insights`** monitors the curated Parquet asset, renders SVG plots and a static HTML dashboard, and republishes the latest insights automatically whenever upstream data changes.

The example ships a miniature dataset under `services/catalog/data/examples/retail-sales/` with three daily CSV extracts. Use it to exercise partitioned runs without any external dependencies.

## 1. Package the job bundles

The pipelines rely on three Node-based bundles.

| Bundle | Slug | Purpose |
| ------ | ---- | ------- |
| `job-bundles/retail-sales-csv-loader` | `retail-sales-csv-loader` | Loads a single partition CSV, normalizes records, and emits the `retail.sales.raw` asset.
| `job-bundles/retail-sales-parquet-builder` | `retail-sales-parquet-builder` | Converts normalized rows into a Parquet file plus a JSON summary and emits `retail.sales.parquet` (partitioned by day).
| `job-bundles/retail-sales-visualizer` | `retail-sales-visualizer` | Reads the warehouse summaries, generates a revenue SVG plot and `index.html`, and publishes the `retail.sales.report` dashboard asset.

Rebuild each bundle so the artifacts and checksums are fresh:

```bash
npx tsx apps/cli/src/index.ts jobs package job-bundles/retail-sales-csv-loader --force
npx tsx apps/cli/src/index.ts jobs package job-bundles/retail-sales-parquet-builder --force
npx tsx apps/cli/src/index.ts jobs package job-bundles/retail-sales-visualizer --force
```

## 2. Publish the bundles

Publish the tarballs to the job bundle registry (replace the token with an operator credential in your environment):

```bash
curl -X POST http://127.0.0.1:4000/job-bundles \\
  -H 'Authorization: Bearer example-operator-token-123' \\
  -H 'Content-Type: application/json' \\
  --data @tmp/retail-csv-loader-bundle.json

curl -X POST http://127.0.0.1:4000/job-bundles \\
  -H 'Authorization: Bearer example-operator-token-123' \\
  -H 'Content-Type: application/json' \\
  --data @tmp/retail-parquet-builder-bundle.json

curl -X POST http://127.0.0.1:4000/job-bundles \\
  -H 'Authorization: Bearer example-operator-token-123' \\
  -H 'Content-Type: application/json' \\
  --data @tmp/retail-visualizer-bundle.json
```

Use `apps/cli/src/scripts/publishBundlePayload.ts` (or your own helper) to generate the payload JSON from the packaged artifacts.

## 3. Register job definitions

Register the three jobs with the catalog API. The definitions live in `services/catalog/src/workflows/examples/retailSalesExamples.ts` and are validated by `retailSalesExamples.test.ts`.

```bash
curl -X POST http://127.0.0.1:4000/jobs \\
  -H 'Authorization: Bearer example-operator-token-123' \\
  -H 'Content-Type: application/json' \\
  --data '$(node -p "JSON.stringify(require(\"./tmp/retail-csv-loader-job.json\"))")'

curl -X POST http://127.0.0.1:4000/jobs \\
  -H 'Authorization: Bearer example-operator-token-123' \\
  -H 'Content-Type: application/json' \\
  --data '$(node -p "JSON.stringify(require(\"./tmp/retail-parquet-builder-job.json\"))")'

curl -X POST http://127.0.0.1:4000/jobs \\
  -H 'Authorization: Bearer example-operator-token-123' \\
  -H 'Content-Type: application/json' \\
  --data '$(node -p "JSON.stringify(require(\"./tmp/retail-visualizer-job.json\"))")'
```

Each payload pins the bundle via `entryPoint` (`bundle:retail-sales-visualizer@0.1.0#handler`, etc.) and matches the schemas exported from the example module.

## 4. Create the workflows

### 4.1 Daily ingest

The ingest workflow declares two partitioned assets:

- `retail.sales.raw` — time-window partitioned by day and produced by the CSV loader.
- `retail.sales.parquet` — time-window partitioned by day and produced by the Parquet builder.

Declare the workflow using the definition exported from the examples module:

```bash
curl -X POST http://127.0.0.1:4000/workflows \\
  -H 'Authorization: Bearer example-operator-token-123' \\
  -H 'Content-Type: application/json' \\
  --data '$(node -p "JSON.stringify(require(\"./tmp/retail-sales-daily-ingest.json\"))")'
```

The workflow expects the following run parameters:

| Parameter | Description |
| --------- | ----------- |
| `dataRoot` | Directory containing the partitioned CSV files (`services/catalog/data/examples/retail-sales`). |
| `warehouseDir` | Directory where Parquet files and summaries should be written. |
| `datasetName` | (Optional) Prefix used to locate CSV files. Defaults to `retail_sales`. |
| `partitionKey` | Date partition (`YYYY-MM-DD`). Also supplied to the run-level `partitionKey` field when executing the workflow. |

### 4.2 Insights publishing

The publishing workflow consumes the curated Parquet asset and publishes a dashboard asset with `autoMaterialize.onUpstreamUpdate = true`. Whenever `retail.sales.parquet` is refreshed, the asset materializer will enqueue `retail-sales-insights` automatically.

```bash
curl -X POST http://127.0.0.1:4000/workflows \\
  -H 'Authorization: Bearer example-operator-token-123' \\
  -H 'Content-Type: application/json' \\
  --data '$(node -p "JSON.stringify(require(\"./tmp/retail-sales-insights.json\"))")'
```

Parameters:

| Parameter | Description |
| --------- | ----------- |
| `warehouseDir` | Location of the Parquet partitions and summaries (same value used by the ingest workflow). |
| `outputDir` | Destination for generated HTML, SVG, and metrics files. |
| `reportTitle` | Optional title (defaults to “Retail Sales Daily Report”). |
| `lookback` | Optional number of partitions to include in the trend chart (default `14`). |

## 5. Run the workflows

### 5.1 Seed a partition

Trigger the ingest workflow for a specific day. Provide both the run-level partition key and the matching workflow parameter:

```bash
curl -X POST http://127.0.0.1:4000/workflows/retail-sales-daily-ingest/run \\
  -H 'Authorization: Bearer example-operator-token-123' \\
  -H 'Content-Type: application/json' \\
  --data '{
    "partitionKey": "2024-01-01",
    "parameters": {
      "partitionKey": "2024-01-01",
      "dataRoot": "services/catalog/data/examples/retail-sales",
      "warehouseDir": "/tmp/retail/warehouse"
    }
  }'
```

Repeat for additional days (`2024-01-02`, `2024-01-03`) to populate three partitions with the bundled fixtures.

### 5.2 Auto-materialized insights

When `retail.sales.parquet` is updated, the asset materializer emits an `upstream-update` event and enqueues `retail-sales-insights`. Provide the static parameters once via manual run so the workflow knows where to publish output:

```bash
curl -X POST http://127.0.0.1:4000/workflows/retail-sales-insights/run \\
  -H 'Authorization: Bearer example-operator-token-123' \\
  -H 'Content-Type: application/json' \\
  --data '{
    "parameters": {
      "warehouseDir": "/tmp/retail/warehouse",
      "outputDir": "/tmp/retail/report",
      "reportTitle": "Daily Retail Sales"
    }
  }'
```

Subsequent Parquet materializations will retrigger the workflow automatically. Inspect produced assets via:

```bash
curl -sS http://127.0.0.1:4000/workflows/retail-sales-daily-ingest/assets | jq
curl -sS http://127.0.0.1:4000/workflows/retail-sales-insights/assets | jq
```

Use the history endpoint to fetch specific partitions (e.g. `?partitionKey=2024-01-02`). The report asset payload lists the generated artifacts (`index.html`, `revenue-trend.svg`, `metrics.json`) so you can host or archive them downstream.

## 6. Reference definitions

- Job and workflow definitions: `services/catalog/src/workflows/examples/retailSalesExamples.ts`
- Validation test: `services/catalog/tests/retailSalesExamples.test.ts`
- Sample CSV data: `services/catalog/data/examples/retail-sales/`

These examples provide a ready-made playground for partition-aware pipelines and asset-driven auto materialization. Combine them with the existing directory insights demo to explore fan-out steps, bundle packaging, and downstream automation end-to-end.
