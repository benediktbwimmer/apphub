# Metastore Service

The metastore provides a flexible metadata backend for platform features that need to persist JSON documents without adding bespoke tables to the core schema. It runs as a standalone Fastify service in `services/metastore`, sharing the PostgreSQL instance with the core API but storing its data in a dedicated `metastore` schema.

## Capabilities
- Store arbitrary JSON metadata per record, scoped by `namespace` + `key`.
- Track auditing details (`created_at`, `updated_at`, `created_by`, `updated_by`, `version`, optional soft deletes) for compliance and debugging.
- Support expressive search with boolean composition, range comparisons, containment checks, and array membership across metadata fields and top-level attributes.
- Enforce optimistic locking via the `version` column, so clients cannot overwrite concurrent updates accidentally.
- Emit Prometheus metrics (`metastore_http_requests_total`, `metastore_http_request_duration_seconds`) and health checks (`/healthz`, `/readyz`, `/metrics`).
- Accept JSON merge-style patches for records, allowing deep metadata updates, tag add/remove/set operations, and targeted key removal without resending entire documents.
- Expose audit trails (`GET /records/:namespace/:key/audit`) and an irreversible purge path for compliance-driven deletions.
- Reload bearer token definitions at runtime via `/admin/tokens/reload` to simplify credential rotation.

## Data Model
```text
metastore_records
  id               BIGSERIAL PRIMARY KEY
  namespace        TEXT NOT NULL
  record_key       TEXT NOT NULL
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb
  tags             TEXT[] NOT NULL DEFAULT '{}'::text[]
  owner            TEXT
  schema_hash      TEXT
  version          INTEGER NOT NULL DEFAULT 1
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  deleted_at       TIMESTAMPTZ
  created_by       TEXT
  updated_by       TEXT

metastore_record_audits
  record_id        BIGINT
  namespace        TEXT NOT NULL
  record_key       TEXT NOT NULL
  action           TEXT NOT NULL (create | update | delete | restore)
  actor            TEXT
  previous_version INTEGER
  version          INTEGER
  metadata         JSONB
  previous_metadata JSONB
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

GIN indexes exist on `metadata`, `tags`, and `updated_at` to keep search queries responsive without introducing Elasticsearch.

## API Surface
## Record Domain Service
The HTTP layer delegates record mutations to `services/metastore/src/services/recordService.ts`. The service wraps repository calls in transactions, emits record stream messages, and publishes `metastore.record.*` events so API handlers stay thin. Each method accepts a payload plus an `OperationContext` (actor + logger) and returns serialized records ready for JSON responses. When adding new record-facing endpoints, extend the service first so event emission and optimistic locking remain consistent.

### Service responsibilities
- create/update/delete helpers call the appropriate repository function inside `withTransaction`, capture the updated row, and automatically dispatch stream + event bus notifications
- read helpers (`fetchRecord`, `searchRecords`) reuse shared query builders to avoid duplicating SQL in routes
- bulk operations reuse the same mutation helpers and defer event emission until the surrounding transaction succeeds
- restore helpers encapsulate audit snapshot lookups (by `auditId`/`version`) and publish `restoredFrom` metadata in the update event payload

### Extending the service
1. Add a method to the service that encapsulates the database work and emits domain events.
2. Write unit tests at `services/metastore/tests/unit/recordService.test.ts` covering happy paths and error cases.
3. Update the route handler to call the new method, only handling scope/namespace guards and input validation.
4. If the method produces new events, update integration tests under `services/metastore/tests/integration` to assert stream or audit side effects.

| Endpoint | Description | Auth Scope |
| --- | --- | --- |
| `POST /records` | Create a record (idempotent on key). Returns 201 on first write and 200 on no-op. | `metastore:write` |
| `PUT /records/:namespace/:key` | Upsert or restore a record. Accepts `expectedVersion` for optimistic locking. | `metastore:write` |
| `PATCH /records/:namespace/:key` | Deep-merge metadata, adjust tags (set/add/remove), and optionally clear fields. | `metastore:write` |
| `GET /records/:namespace/:key` | Fetch a record. Optional `includeDeleted=true` exposes soft-deleted rows. | `metastore:read` |
| `DELETE /records/:namespace/:key` | Soft delete a record (retains metadata + audit trail). | `metastore:delete` |
| `GET /records/:namespace/:key/audit` | Retrieve the audit trail for a record with paging. | `metastore:read` |
| `DELETE /records/:namespace/:key/purge` | Hard delete a record and its audit entries (irreversible). | `metastore:admin` |
| `POST /records/search` | Execute filtered, paginated search requests. Supports boolean filter trees, sort order, projection, and result counts. | `metastore:read` |
| `POST /records/bulk` | Apply batched upsert/delete operations; optional `continueOnError` yields per-op success/error statuses. | `metastore:write` (+ `metastore:delete` if deletes present) |
| `GET /healthz` / `GET /readyz` | Liveness and readiness probes (readiness checks Postgres connectivity). | none |
| `GET /metrics` | Prometheus metrics (disabled when `APPHUB_METRICS_ENABLED=0`). | none |
| `POST /admin/tokens/reload` | Reload bearer tokens from file/env without restarting the service. | `metastore:admin` |

### Search DSL
Search payloads accept a filter tree composed of condition, group, and not nodes. Example:

```json
{
  "namespace": "analytics",
  "filter": {
    "type": "group",
    "operator": "and",
    "filters": [
      {
        "field": "metadata.status",
        "operator": "eq",
        "value": "active"
      },
      {
        "type": "group",
        "operator": "or",
        "filters": [
          {
            "field": "metadata.metrics.latency_ms",
            "operator": "lt",
            "value": 200
          },
          {
            "field": "tags",
            "operator": "array_contains",
            "value": ["priority"]
          }
        ]
      }
    ]
  },
  "sort": [{ "field": "updatedAt", "direction": "desc" }],
  "limit": 25,
  "offset": 0,
  "projection": ["namespace", "key", "metadata.status"]
}
```

Supported comparison operators:
- `eq`, `neq`
- `lt`, `lte`, `gt`, `gte`, `between`
- `contains` (JSON containment)
- `has_key` (object key existence)
- `array_contains` (array membership for metadata arrays or `tags`)
- `exists`

Boolean operators: `and`, `or`, plus `not` combinator. Filter depth is capped at 8 levels to protect query compilation. Numeric, boolean, and ISO 8601 timestamp comparisons auto-cast metadata values when using `<`, `>`, or `between`.

### Query Shortcuts & Presets
- `POST /records/search` also accepts a `q` parameter with a lightweight `field:value` syntax (e.g. `key:ingest owner=ops status:"in progress"`). Terms default to AND semantics and automatically prefix unknown fields with `metadata.`.
- Combine `q`, structured `filter`, and a `preset` in the same request—the server merges them into a single AND group before compiling SQL.
- Define reusable presets via `APPHUB_METASTORE_SEARCH_PRESETS` (inline JSON) or `APPHUB_METASTORE_SEARCH_PRESETS_PATH` (JSON file). Each preset declares a name, JSON filter payload, and optional `requiredScopes`; callers must hold at least one of the listed scopes.


## Authentication & Namespaces
- Bearer tokens are loaded from `APPHUB_METASTORE_TOKENS`, `APPHUB_METASTORE_TOKENS_PATH`, or fall back to `APPHUB_OPERATOR_TOKENS`. 
- Tokens declare scopes (`metastore:read`, `metastore:write`, `metastore:delete`, `metastore:admin`) and optional namespace allow-lists. Admin scope implies all other scopes and namespace access.
- Set `APPHUB_AUTH_DISABLED=1` in local development to bypass auth entirely.

## Running Locally
```bash
npm install
npm run dev --workspace @apphub/metastore
```

The service listens on `http://127.0.0.1:4100` by default. Update `PORT` / `HOST` / `DATABASE_URL` env vars as needed. Set `APPHUB_METASTORE_PG_SCHEMA` (default `metastore`) to control which Postgres schema is used. The server automatically runs migrations on startup.

### Idempotency and retriable mutations

Write-facing endpoints (`POST /records`, `PUT /records/:namespace/:key`, `PATCH /records/:namespace/:key`, `DELETE /records/:namespace/:key`, `DELETE /records/:namespace/:key/purge`, and `POST /records/bulk`) now accept an optional `idempotencyKey`. When supplied, the repository stores a fingerprint of the resulting record version and short-circuits future retries that reuse the same key and payload. Responses include an `idempotent` flag so callers can detect when nothing changed. Duplicate submissions with mismatched payloads are rejected with `409 idempotency_conflict`.

Even without an explicit key, the API compares normalized payloads to the current record. If a request would not change persisted metadata, tags, owner, schema hash, or deletion state, the service returns `idempotent: true` and skips audit/event emission. Queue consumers (for example, the Filestore sync) also forward Filestore idempotency markers and journal ids into these checks so repeated node events no longer churn metastore record versions.

## Event Publishing

Metastore publishers should emit lifecycle changes (create/update/delete) through the shared event bus. Import the helper and publish from the code path that commits the record mutation:

```ts
import { createEventPublisher } from '@apphub/event-bus';

const publisher = createEventPublisher();

await publisher.publish({
  type: 'metastore.record.updated',
  source: 'metastore.api',
  payload: {
    namespace,
    key,
    version: record.version
  },
  correlationId: request.id
});
```

Events arrive in the core's `workflow_events` table and on the WebSocket stream (`workflow.event.received`). Downstream workflows can subscribe to these signals once event-driven scheduling is enabled.

Emitted event types include:
- `metastore.record.created` whenever a record is first written via POST/PUT.
- `metastore.record.updated` for PATCH/PUT mutations (including restores).
- `metastore.record.deleted` for soft deletes (`mode: "soft"`) and purges (`mode: "hard"`).

## Realtime Monitoring

- `GET /stream/records` streams record lifecycle events as server-sent events (or via WebSocket if the client upgrades). Each payload includes the namespace, key, action, version, and timestamps so operators can drive dashboards without polling.
- Heartbeats (`: ping`) are sent every 15 seconds with a `retry: 5000` directive so clients auto-reconnect on transient network issues. Metrics report active subscribers per transport under `metastore_record_stream_subscribers`.
- `GET /filestore/health` surfaces the filestore consumer lag, most recent event timestamps, and retry counters. When the consumer falls behind longer than `METASTORE_FILESTORE_STALL_THRESHOLD_SECONDS` (default 60s) the endpoint returns HTTP 503 and the metric `metastore_filestore_consumer_stalled` flips to `1`.

## Operator UI

The frontend exposes a full-crud Metastore explorer under `/services/metastore`. Operators can:

- Search within a namespace (with optional soft-delete visibility) and inspect record metadata, tags, owners, and schema hashes.
- Edit records with optimistic locking, apply targeted JSON patches, or restore soft-deleted entries via the toolbar actions.
- Execute bulk upsert/delete payloads using the inline dialog, with validation mirroring the API schemas.
- Review audit history and follow cross-links to related Timestore datasets or assets for additional context.
- Trigger purge operations when holding the `metastore:admin` scope, with clear confirmations.

## Testing
```bash
npm run lint --workspace @apphub/metastore
npm run test:integration --workspace @apphub/metastore
```

Integration tests spin up an embedded Postgres instance, build the Fastify app, and exercise the CRUD/search/bulk endpoints end-to-end.
