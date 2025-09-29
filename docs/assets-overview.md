# Workflow Assets & Auto-Materialization

Workflow assets turn ad-hoc outputs into first-class records the catalog can index, audit, and reuse. When steps declare which named assets they produce or consume, every run automatically contributes to a shared lineage graph and can participate in automatic freshness reconciliation.

## Why Assets Matter
- **Ownership & Dependencies:** Producers/consumers are captured for each asset, making it easy to see which steps (and workflows) emit or rely on a given dataset, report, or model.
- **Always-Fresh Snapshots:** The catalog records the latest payload, schema, freshness hints, producer step status, and run timestamps. Downstream automation can decide when to reuse or regenerate an asset based on declared TTLs or cadence.
- **History & Auditing:** Each production event is versioned; `/workflows/:slug/assets/:assetId/history` exposes prior payloads so you can diff outputs, trace regressions, or rebuild from a specific run.
- **Cross-Workflow Sharing:** Assets provide a contract between workflows. One workflow can `consume` an asset produced by another, and the orchestrator will ensure the dependency exists (or rerun the producer) before advancing.
- **Automation Hooks:** Structured metadata enables policy checks (e.g. fail deployments if an asset is stale), alerting when high-value assets change, or feeding dashboards with provenance data.

## Declaring Assets in Workflows
Inside a workflow definition, attach `produces` and `consumes` blocks to job steps. Assets support an optional `autoMaterialize` block in addition to `freshness` when you want the system to trigger reruns.

```json
{
  "id": "report",
  "jobSlug": "generate-visualizations",
  "produces": [
    {
      "assetId": "directory.insights.report",
      "schema": {
        "type": "object",
        "properties": {
          "outputDir": { "type": "string" },
          "reportTitle": { "type": "string" },
          "generatedAt": { "type": "string", "format": "date-time" },
          "artifacts": {
            "type": "array",
            "items": { "type": "object" }
          }
        },
        "required": ["outputDir", "reportTitle", "generatedAt", "artifacts"]
      },
      "freshness": { "ttlMs": 3_600_000 },
      "autoMaterialize": {
        "onUpstreamUpdate": true,
        "priority": 5,
        "parameterDefaults": {
          "archiveDir": "/app/tmp/directory-insights/archives",
          "reportAsset": {
            "assetId": "directory.insights.report",
            "outputDir": "/app/tmp/directory-insights/output",
            "artifacts": [
              { "relativePath": "scan-data.json" },
              { "relativePath": "index.html" },
              { "relativePath": "summary.md" }
            ]
          }
        }
      }
    }
  ],
  "consumes": [
    { "assetId": "directory.insights.archive" }
  ]
}
```

- `freshness.ttlMs` and `freshness.cadenceMs` schedule delayed `asset.expired` events (via Redis/BullMQ) so assets can be refreshed without polling.
- `autoMaterialize.onUpstreamUpdate` signals that the producing workflow should automatically run when any consumed asset publishes a newer `asset.produced` event.
- `autoMaterialize.priority` is reserved for future scheduling heuristics (lower numbers indicate higher priority).
- `autoMaterialize.parameterDefaults` seeds workflow inputs when the materializer fires. Combine this with `defaultParameters` or persisted partition parameters so downstream jobs have fully-resolved paths and payload stubs.

If no `autoMaterialize` block is supplied, workflows continue to behave exactly as before—updates and expirations are ignored by the materializer.

## Returning Assets from Jobs
At runtime your job handler should include an `assets` array in the returned result:

```ts
return {
  status: 'succeeded',
  result: {
    files: artifacts,
    assets: [
      {
        assetId: 'directory.insights.report',
        payload: {
          outputDir,
          reportTitle,
          generatedAt,
          artifacts: artifacts.map(({ relativePath, mediaType, sizeBytes }) => ({
            relativePath,
            mediaType,
            sizeBytes
          }))
        },
        producedAt: new Date().toISOString()
      }
    ]
  }
};
```

## Asset Events
The workflow orchestrator publishes structured events to the AppHub event bus:

- `asset.produced` – emitted whenever a workflow step records a produced asset. Payload includes the asset id, producing workflow slug/id, run key, run id, step id, producedAt timestamp, and the declared `freshness` block.
- `asset.expired` – emitted when a scheduled freshness timer (TTL/cadence) elapses. The payload mirrors the produced event and specifies the expiry reason (`ttl` or `cadence`).

Both events flow through Redis (or inline during tests) and are consumed by the asset materializer worker and any other interested services.

## Asset Materializer Worker
`services/catalog/src/assetMaterializerWorker.ts` maintains an in-memory graph of workflow asset producers/consumers. It:

1. Loads workflow definitions and tracks which workflows produce and consume each asset.
2. Subscribes to `asset.produced`, `asset.expired`, and `workflow.definition.updated` events.
3. Enqueues `auto-materialize` workflow runs when upstream assets update or when an asset expires per its freshness policy.
4. Guards against duplicate inflight runs, applies exponential backoff after repeated failures, and annotates `workflow_runs.trigger` with `{ type: 'auto-materialize', ... }` for auditing.

The worker also processes the `apphub_asset_event_queue` BullMQ queue to fire delayed `asset.expired` events scheduled when assets provide a TTL or cadence.

Operators can now inspect auto-materialization activity without reaching for SQL. The catalog API exposes `/workflows/:slug/auto-materialize`, returning recent auto-runs, any active materializer claim, and the current failure backoff window. The Workflows UI surfaces the same data in the **Auto-Materialization Activity** panel on the workflow detail page, alongside quick filters and freshness indicators for auto-managed assets.

## Inspecting Assets via API
The catalog exposes inventory and history endpoints:

- **List assets for a workflow**
  ```bash
  curl -sS http://127.0.0.1:4000/workflows/directory-insights-report/assets | jq
  ```
- **Fetch history for a specific asset**
  ```bash
  curl -sS http://127.0.0.1:4000/workflows/directory-insights-report/assets/directory.insights.report/history | jq
  ```

Each record includes producer/consumer step metadata, the most recent payload, schema, freshness hints, and the run/step identifiers that emitted it.

## Database Storage
`workflow_asset_declarations` persists both the `auto_materialize` and `partitioning` JSON payloads alongside each asset's schema and freshness hints. Existing records remain valid thanks to nullable columns, and API responses include the new `autoMaterialize` and `partitioning` objects when present.

## Partitioned Assets

Some datasets are naturally partitioned (e.g. daily exports, per-customer snapshots). Declare these by adding a `partitioning` block to the asset definition:

```json
{
  "assetId": "reports.partitioned",
  "partitioning": {
    "type": "static",
    "keys": ["2024-01", "2024-02", "2024-03"]
  }
}
```

Supported partition strategies:
- `static`: enumerate a finite list of partition keys.
- `timeWindow`: rolling hourly/daily/weekly/monthly windows (optionally with a timezone and custom key format).
- `dynamic`: keys discovered at runtime (the catalog records every novel key it sees).

When a workflow produces a partitioned asset, the run **must** supply a `partitionKey` (via the `/workflows/:slug/run` payload). If the job handler omits `partitionKey` from the emitted asset, the orchestrator defaults to the run-level key so lineage stays consistent.

API helpers:
- `GET /workflows/:slug/assets/:assetId/history?partitionKey=2024-01` filters history to a specific partition.
- `GET /workflows/:slug/assets/:assetId/partitions` lists known partitions, their materialization counts, and the latest run metadata. For static/time-window assets the response also includes upcoming partitions that have not yet materialized.

## Operational Notes
- The worker respects `ASSET_MATERIALIZER_BASE_BACKOFF_MS`, `ASSET_MATERIALIZER_MAX_BACKOFF_MS`, and `ASSET_MATERIALIZER_REFRESH_INTERVAL_MS` environment variables for tuning backoff and graph refresh cadence.
- Launch the worker via `npm run materializer --workspace @apphub/catalog` (or `npm run dev:materializer` from the repo root during local development).
- Event handling degrades gracefully when Redis is configured as `inline`; delayed expirations fall back to in-process timers.

## Design Patterns
- Use structured payloads (rich JSON objects) so downstream consumers can extract metrics without hitting the filesystem.
- Include TTL or cadence in the schema if data freshness matters; the catalog stores these hints for monitoring.
- When migrating workflows, update `produces` declarations first so subsequent runs populate lineage immediately.
- Combine assets with queue-based automation: e.g. a release workflow can block until `directory.insights.report` is fresh, or trigger downstream jobs when an asset changes.
- Chain assets across workflows. The `directory-insights-archive` workflow (see `docs/directory-insights-archive-workflow.md`) consumes `directory.insights.report` and produces `directory.insights.archive`, making it easy to test event-driven materialization heuristics.
- Explore the retail sales example (`docs/retail-sales-workflows.md`) for a partitioned ingest + auto-materialized reporting pipeline that emits Parquet files, SVG plots, and a static dashboard.
- Try the fleet telemetry scenario (`docs/fleet-telemetry-workflows.md`) to see `dynamic` partition keys materialise automatically as new instruments report data.
- Model hourly instrument drops with the environmental observatory walkthrough (`docs/environmental-observatory-workflows.md`) to watch DuckDB snapshots trigger downstream plots and reports automatically.

By treating workflow outputs as assets, you gain a built-in lineage system: reproducible artifacts, traceable provenance, and a queryable history that spans every workflow run while benefiting from automatic reconciliation when assets become stale.
