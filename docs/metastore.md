# Metastore Service

The metastore provides a flexible metadata backend for platform features that need to persist JSON documents without adding bespoke tables to the catalog schema. It runs as a standalone Fastify service in `services/metastore`, sharing the PostgreSQL instance with the catalog API but storing its data in a dedicated `metastore` schema.

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

Events arrive in the catalog's `workflow_events` table and on the WebSocket stream (`workflow.event.received`). Downstream workflows can subscribe to these signals once event-driven scheduling is enabled.

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
