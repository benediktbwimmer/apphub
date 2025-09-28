# Event Bus & Workflow Event Ingress

Apphub services now share a BullMQ-backed event bus so workflow scheduling and operator tooling can react to cross-service changes without polling. The catalog service persists every accepted event to PostgreSQL and fans it out over the existing WebSocket stream (`/ws`).

## Envelope Contract

All events must conform to the shared envelope exported by `@apphub/event-bus`:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | No | Auto-assigned UUID when omitted. Must be unique per event. |
| `type` | `string` | Yes | Namespaced identifier (`service.domain.action`). |
| `source` | `string` | Yes | Logical publisher (`metastore.worker`, `filestore.api`). |
| `occurredAt` | `string \| Date` | No | Defaults to current time. Stored in UTC. |
| `payload` | `JsonValue` | No | Defaults to `{}`; should remain small (<256 KB). |
| `correlationId` | `string` | No | Carries trace or workflow linkage. |
| `ttl` | `number` | No | Optional milliseconds-to-live hint. Stored as `ttl_ms`. |
| `metadata` | `Record<string, JsonValue>` | No | Non-indexed auxiliary attributes. |

`@apphub/event-bus` exposes:

```ts
import { createEventPublisher } from '@apphub/event-bus';

const publisher = createEventPublisher();

await publisher.publish({
  type: 'metastore.record.updated',
  source: 'metastore.api',
  payload: {
    namespace: 'feature-flags',
    key: 'frontend-search',
    version: 12
  },
  correlationId: 'req-41ac2fd3'
});
```

### Runtime Configuration

- `APPHUB_EVENT_QUEUE_NAME` overrides the default queue (`apphub_event_ingress_queue`).
- `EVENT_INGRESS_CONCURRENCY` tunes worker parallelism (default `5`).
- `APPHUB_EVENTS_MODE=inline` keeps publishing synchronous and skips the dedicated worker—useful for local development.

### Workflow Event Context

Workflow job executions now carry a lightweight context payload so downstream publishers can link emitted events back to their workflow topology. The orchestrator seeds an AsyncLocalStorage scope with

- `workflowDefinitionId`
- `workflowRunId`
- `workflowRunStepId`
- `jobRunId`
- `jobSlug`

Node handlers running in-process can call `getWorkflowEventContext()` from `@apphub/catalog/jobs/runtime` to read the current store. Sandbox and Docker adapters serialize the same payload into the `APPHUB_WORKFLOW_EVENT_CONTEXT` environment variable; the sandbox context object also exposes `workflowEventContext` plus `getWorkflowEventContext()` (Python bundles receive matching attributes) for convenience. Child bootstrap code keeps the AsyncLocalStorage scope active so downstream imports resolve the same data.

`@apphub/event-bus` now injects this context automatically into every envelope that does not already include `metadata.__apphubWorkflow`. The reserved block is trimmed to the required fields, strings are normalized, and payloads larger than 2 KB (UTF-8) are dropped to protect downstream storage. Existing publishers that set `metadata.__apphubWorkflow` manually keep their values; everyone else gets the enriched metadata with no API changes.

## Ingress Worker & Persistence

The catalog worker (`npm run events --workspace @apphub/catalog`) consumes the queue and writes into `workflow_events`:

```sql
CREATE TABLE workflow_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id TEXT,
  ttl_ms INTEGER,
  metadata JSONB
);
```

Every record is emitted to WebSocket subscribers via `workflow.event.received` events so operators can trace trigger activity in real time.

The event trigger worker (`npm run event-triggers --workspace @apphub/catalog`) consumes a dedicated queue (`apphub_event_trigger_queue` by default), evaluates trigger predicates, records delivery history, and enqueues matching workflows. In local inline mode (`REDIS_URL=inline` with `APPHUB_ALLOW_INLINE_MODE=true`) both ingress and trigger processing happen in-process without Redis.

### Monitoring & Health

- `GET /admin/event-health` surfaces queue depth, in-memory metrics (per-source lag, trigger success/failure counters), current rate-limit configuration, and paused sources/triggers.
- `GET /admin/queue-health` enumerates all catalog BullMQ queues (ingest, build, launch, workflow, example bundle, ingress triggers) with live depth and latency readings; the data also feeds the Prometheus endpoint exposed at `/metrics/prometheus`.
- Set `EVENT_SOURCE_RATE_LIMITS` with entries like `[{"source":"metastore.api","limit":200,"intervalMs":60000,"pauseMs":60000}]` to throttle noisy publishers; default is unlimited.
- Trigger auto-pausing is controlled via `EVENT_TRIGGER_ERROR_THRESHOLD` (default `5` failures within `EVENT_TRIGGER_ERROR_WINDOW_MS`, default `300000`) and resumes after `EVENT_TRIGGER_PAUSE_MS` (default `300000`).

## Inspecting Events

Use the catalog admin API to explore historical envelopes with flexible filters and cursor pagination:

```
GET /admin/events?type=metastore.record.updated&source=metastore.api&correlationId=req-41ac2fd3&from=2024-12-01T00:00:00Z&limit=50
```

Supported query parameters:

- `type`, `source`, `correlationId` — exact matches on event metadata.
- `from`, `to` — inclusive ISO-8601 bounds applied to `occurred_at`.
- `jsonPath` — Postgres JSONPath expression evaluated against the payload (`jsonb_path_exists`).
- `limit` — page size (1–200, default `100`).
- `cursor` — opaque token returned in `page.nextCursor` for follow-up requests.

Responses now include derived insights alongside the raw row:

```json
{
  "data": {
    "events": [
      {
        "id": "evt-001",
        "type": "asset.produced",
        "severity": "warning",
        "links": {
          "workflowDefinitionIds": ["wf-alpha"],
          "datasetSlugs": ["weather"]
        },
        "derived": {
          "type": "asset.produced",
          "payload": { "assetId": "asset-7", "workflowRunId": "run-42" }
        },
        "payload": { ... }
      }
    ],
    "page": {
      "nextCursor": "eyJ2IjoidjEiLCJvY2N1cnJlZEF0IjoiMjAyNC0xMi0wMVQwMDowMDowMC4wMDBaIiwiaWQiOiJldnQtMDAxIn0",
      "hasMore": true,
      "limit": 50
    }
  },
  "schema": { ... }
}
```

The WebSocket stream at `/ws` emits the same enriched structure via `workflow.event.received`, along with dedicated frames for platform sub-systems (`asset.produced`, `metastore.record.updated`, `timestore.partition.created`, and Filestore node events). Clients can derive severity chips or cross-links without reparsing raw payloads.

## Explorer Health Overlays

The Events Explorer UI now ships with a health rail that surfaces live scheduler telemetry alongside the event feed. The rail refreshes every 30 seconds (or whenever an operator presses **Refresh**) and highlights:

- **Per-source lag:** Average, latest, and maximum lag in milliseconds, plus throttled and dropped counts
- **Retry backlog:** Summaries for ingress events, trigger deliveries, and workflow steps, each with total and overdue counts plus the next scheduled attempt
- **Paused routing:** Active source and trigger pauses so operators can immediately see why certain events are not progressing

Collapse the rail to reclaim screen real estate or expand it for deeper triage. Metrics use the same `/admin/event-health` snapshot that powers workflow topology overlays, so the data matches what SRE dashboards show.

## Saved Views

Operators can now pin commonly used filter combinations as _saved views_. Each saved view preserves the current Explorer filters (type, source, severity, time range, JSONPath) and exposes quick actions:

1. Configure filters in the Explorer and use **Save view** to capture them. Optionally supply a description and mark the view as shared across the org.
2. Click the saved view name to apply it. The Explorer records usage so teams can see which presets are popular.
3. Rename or delete private views, and share them once they are stable. Shared views are read-only for everyone except the original owner.

Saved views display lightweight analytics derived from the past 15 minutes of history:

- **Events/minute** shows the observed throughput for the filtered scope.
- **Error ratio** highlights the relative frequency of critical and error severity events.
- **Sampled count** indicates how many events contributed to the snapshot and whether the sample hit internal limits.

Use these metrics to sanity-check noisy pipelines before diving into payloads, and promote shared presets so on-call engineers land on the right filters immediately.

## Publishing Checklist

1. Always provide a stable `type` and `source`—they drive trigger routing and observability.
2. Use deterministic payloads (no transient timestamps) so replaying an event yields the same evaluation result.
3. Keep payloads lightweight; large blobs belong in Filestore or Metastore with a reference in the event.
4. Populate `correlationId` with upstream trace/span identifiers when available for end-to-end debugging.
5. Handle `publisher.publish` rejections and retry with backoff; the helper throws if validation fails or Redis is unavailable.

Services that already emit Redis notifications can migrate to this bus incrementally by publishing both until downstream consumers switch over.
