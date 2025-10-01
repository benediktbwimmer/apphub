# Workflow Topology Graph Data Contract (v1 Draft)

## Versioning & Envelope
```json
{
  "version": "v1",
  "generatedAt": "2024-03-18T18:45:00.000Z",
  "scope": "production",
  "nodes": [...],
  "edges": [...],
  "overlays": {
    "runtime": {
      "runs": [...],
      "assets": [...],
      "triggers": [...]
    }
  }
}
```
- `version`: semantic identifier; backend increments when breaking changes occur.
- `generatedAt`: ISO timestamp when payload assembled.
- `scope`: environment or tenant selector; defaults to `production` for MVP.
- `overlays`: optional real-time data supplementing static topology (see [Update Semantics](#update-semantics)).

## Node Schema
All nodes share base fields:
```json
{
  "id": "workflow:core-sync",
  "type": "workflow",
  "label": "Core Sync",
  "attributes": {
    "owner": "data-platform",
    "domain": "core",
    "environment": "production"
  },
  "metadata": { ... }
}
```
- `id`: globally unique string with namespace prefixes (`workflow:`, `step:`, `trigger:event:`, `trigger:schedule:`, `asset:`, `event-source:`).
- `label`: human-readable title rendered in the graph.
- `attributes`: filterable key/value pairs; keys normalized to camelCase.
- `metadata`: structured payload per node type.

### Workflow Nodes
- `metadata.slug`: workflow slug.
- `metadata.version`: definition version.
- `metadata.parametersSchemaRef`: pointer to schema document.
- `metadata.autoMaterialize`: boolean summarizing presence of auto materialize policies.
- `metadata.tags`: arbitrary string array for search.

### Step Nodes
- `metadata.workflowId`: owning workflow id.
- `metadata.stepId`: step identifier.
- `metadata.stepType`: `job`, `service`, or `fanout`.
- `metadata.dependsOn`: array of upstream step ids.
- `metadata.bundle`: job bundle reference when applicable (`slug`, `strategy`, `version`).

### Trigger Nodes
Two flavors share a base:
- `trigger:event` metadata includes `eventType`, `eventSource`, `predicates`, `throttle`, `maxConcurrency`, `idempotencyKeyExpression`.
- `trigger:schedule` metadata includes `cron`, `timezone`, `startWindow`, `endWindow`, `catchUp`, `parameters` hash.

### Asset Nodes
- `metadata.assetId`: canonical id.
- `metadata.partitioning`: enum (`timeWindow`, `static`, `dynamic`) with configuration.
- `metadata.freshness`: TTL/cadence hints.
- `metadata.autoMaterialize`: policy details (onUpstreamUpdate, priority, parameter defaults).

### Event Source Nodes
- `metadata.source`: string identifier (e.g., `apphub.core`).
- `metadata.description`: optional human description.

## Edge Schema
```json
{
  "id": "trigger:event:observatory-inbox->workflow:observatory-minute-ingest",
  "from": "trigger:event:observatory-inbox",
  "to": "workflow:observatory-minute-ingest",
  "type": "activates",
  "metadata": { ... }
}
```
Edge `type` enumerations:
- `activates`: trigger → workflow.
- `contains`: workflow → step.
- `depends-on`: step → step (implicit via DAG metadata; emitted for completeness).
- `produces`: step → asset.
- `consumes`: step → asset.
- `feeds`: asset → workflow (auto-materialization).
- `emits`: event-source → trigger.

`metadata` field captures relationship context (e.g., partition key hints, dependency rationale, throttle windows).

## Overlay Schema
Overlays provide real-time status without replacing base topology.

### Runtime Runs
```json
{
  "workflowId": "workflow:core-sync",
  "status": "running",
  "runId": "wr-123",
  "startedAt": "2024-03-18T17:30:12.000Z",
  "completedAt": null,
  "durationMs": null,
  "currentStepId": "step:core-sync.fetch",
  "recentFailures": 1
}
```

### Asset Freshness
```json
{
  "assetId": "asset:inventory.snapshot",
  "producedAt": "2024-03-18T16:45:00.000Z",
  "expiresAt": "2024-03-18T18:45:00.000Z",
  "partitionKey": "2024-03-18",
  "freshnessState": "within-ttl"
}
```

### Trigger Health
```json
{
  "triggerId": "trigger:event:observatory-inbox",
  "status": "active",
  "lastFiredAt": "2024-03-18T17:59:10.000Z",
  "pauseState": null,
  "recentFailures": 0
}
```

## Update Semantics
- Full payload fetched via REST; clients receive `ETag` and `Cache-Control: no-store` to force explicit refresh control.
- Incremental overlay updates dispatched over WebSocket channel `workflow.topology.runtime` using the same schema segments.
- Overlay updates include `upsert` semantics; clients reconcile into existing node/edge structures.
- When backend detects incompatible schema changes, it increments `version` and sets `breakingChange: true` flag in envelope.

## Security & Privacy Considerations
- Workflow and asset metadata filtered by environment/tenant before emission; sensitive parameters omitted.
- Trigger predicates stored as expressions but masked when containing literal secrets.
- Runtime overlays redact log URLs unless caller owns `jobs:read` scope.

## Error Handling
- Endpoint returns `503` with `retryAfter` when graph assembler rebuilding cache.
- Overlay stream sends `status: degraded` heartbeat when event ingestion delayed beyond 5 seconds.

## Future Extensions (v1.x Roadmap)
- Incorporate service dependency edges once API inventory matures.
- Support historical snapshots by adding `timeline` slice to envelope.
- Introduce localized labels and domain-specific iconography references for frontend rendering.
