# Workflow Asset Auto-Materialization

The catalog now emits asset lifecycle events and reconciles workflow freshness via an event-driven materializer. This document explains the moving parts and how to opt into automatic reconciliation for workflow assets.

## Event Types

The workflow orchestrator publishes two structured events to the AppHub event bus:

- `asset.produced` – emitted whenever a workflow step records a produced asset. Payload includes the asset id, producing workflow slug/id, run id, step id, producedAt timestamp, and the declared `freshness` block.
- `asset.expired` – emitted when a scheduled freshness timer (TTL/cadence) elapses. The payload mirrors the produced event and specifies the expiry reason (`ttl` or `cadence`).

Both events flow through Redis (or inline during tests) and are consumed by the asset materializer worker and any other interested services.

## Asset Materializer Worker

`src/assetMaterializerWorker.ts` maintains an in-memory graph of workflow asset producers/consumers. It:

1. Loads workflow definitions and tracks which workflows produce and consume each asset.
2. Subscribes to `asset.produced`, `asset.expired`, and `workflow.definition.updated` events.
3. Enqueues `auto-materialize` workflow runs when upstream assets update or when an asset expires per its freshness policy.
4. Guards against duplicate inflight runs, applies exponential backoff after repeated failures, and annotates `workflow_runs.trigger` with `{ type: 'auto-materialize', ... }` for auditing.

The worker also processes the `apphub_asset_event_queue` BullMQ queue to fire delayed `asset.expired` events scheduled when assets provide a TTL or cadence.

## Declaring Policies

Workflow asset declarations (both produced and consumed) now support an optional `autoMaterialize` block in addition to `freshness`:

```json
{
  "id": "build-matrix",
  "type": "job",
  "produces": [
    {
      "assetId": "build.reports",
      "freshness": { "ttlMs": 3_600_000 },
      "autoMaterialize": {
        "onUpstreamUpdate": true,
        "priority": 5
      }
    }
  ],
  "consumes": [
    { "assetId": "repo.snapshot" }
  ]
}
```

- `freshness.ttlMs` and `freshness.cadenceMs` schedule delayed `asset.expired` events (via Redis/BullMQ) so assets can be refreshed without polling.
- `autoMaterialize.onUpstreamUpdate` signals that the producing workflow should automatically run when any consumed asset publishes a newer `asset.produced` event.
- `autoMaterialize.priority` is reserved for future scheduling heuristics (lower numbers indicate higher priority).

If no `autoMaterialize` block is supplied, workflows continue to behave exactly as before—updates and expirations are ignored by the materializer.

## Database Storage

`workflow_asset_declarations` now persists the `auto_materialize` JSON payload alongside `asset_schema` and `freshness`. Existing data is left untouched; the migration simply adds a nullable column. The API responses that surface asset declarations include the new `autoMaterialize` object when present.

## Operational Notes

- The worker respects `ASSET_MATERIALIZER_BASE_BACKOFF_MS`, `ASSET_MATERIALIZER_MAX_BACKOFF_MS`, and `ASSET_MATERIALIZER_REFRESH_INTERVAL_MS` environment variables for tuning backoff and graph refresh cadence.
- The new worker can be launched via `npm run materializer` (or `npm run dev:materializer` from the repo root during local development).
- All event handling degrades gracefully when Redis is configured as `inline`; delayed expirations fall back to in-process timers.

Refer to `services/catalog/src/assetMaterializerWorker.ts` for implementation details and to extend policies in future iterations.
