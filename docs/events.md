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

The event trigger worker (`npm run event-triggers --workspace @apphub/catalog`) consumes a dedicated queue (`apphub_event_trigger_queue` by default), evaluates trigger predicates, records delivery history, and enqueues matching workflows. In local inline mode (`REDIS_URL=inline`) both ingress and trigger processing happen in-process without Redis.

## Inspecting Events

An internal admin endpoint returns recent events with optional filters:

```
GET /admin/events?type=metastore.record.updated&source=metastore.api&from=2024-12-01T00:00:00Z&limit=50
```

Filtering combines on `type`, `source`, `from`, `to`, and `limit` (1–200, default `100`). Entries are ordered by `occurred_at DESC`.

## Publishing Checklist

1. Always provide a stable `type` and `source`—they drive trigger routing and observability.
2. Use deterministic payloads (no transient timestamps) so replaying an event yields the same evaluation result.
3. Keep payloads lightweight; large blobs belong in Filestore or Metastore with a reference in the event.
4. Populate `correlationId` with upstream trace/span identifiers when available for end-to-end debugging.
5. Handle `publisher.publish` rejections and retry with backoff; the helper throws if validation fails or Redis is unavailable.

Services that already emit Redis notifications can migrate to this bus incrementally by publishing both until downstream consumers switch over.
