# Event Schema Registry Plan

## Goals

- Centralise JSON Schema definitions for every event type emitted on the AppHub event bus.
- Support versioned schemas and status management (active, deprecated, draft).
- Expose admin APIs plus a CLI to register / inspect schema versions.
- Enforce schema validation inside the event publisher and ingress worker so invalid payloads are rejected before they hit downstream storage.
- Persist the applied schema version on each `workflow_events` row (and mirror it to Redpanda metadata) so downstream analytics can reason about causality and evolution.

## Data Model

New Postgres table in the core database:

| Column | Type | Notes |
| --- | --- | --- |
| `event_type` | `TEXT` | Namespaced event identifier (`service.domain.action`). |
| `version` | `INTEGER` | Monotonic schema version per event type. Composite PK with `event_type`. |
| `status` | `TEXT` | Enum `draft` \| `active` \| `deprecated`. Only `active` versions are used for validation. |
| `schema` | `JSONB` | Draft-07 JSON Schema document describing the event payload. |
| `metadata` | `JSONB` | Optional registry metadata (owners, change notes, etc.). |
| `created_at` | `TIMESTAMPTZ` | Auto timestamp. |
| `created_by` | `TEXT` | Operator or service identifier. |
| `updated_at` | `TIMESTAMPTZ` | Auto timestamp. |
| `updated_by` | `TEXT` | Operator or service identifier. |

Indexes:

- Primary key `(event_type, version)`.
- Partial index on `event_type` filtered by `status = 'active'` to accelerate lookups.

`workflow_events` table gains:

- `schema_version INTEGER`
- `schema_hash TEXT` ( SHA-256 of the registered schema for debugging )

## Runtime Contract

1. **Registration**
   - `POST /admin/event-schemas` accepts `{ eventType, version?, status?, schema, metadata?, author? }`.
   - Server enforces monotonically increasing versions per event type and runs JSON Schema shape validation via AJV.
   - Duplicate submissions return the existing row (idempotent on `(eventType, version)`).
   - `GET /admin/event-schemas` lists historical versions; `GET /admin/event-schemas/:eventType/latest` returns the active schema.

2. **Publisher Integration**
   - `@apphub/event-bus` gains optional `schemaVersion` on `EventEnvelopeInput`.
   - Publisher looks up the schema registry (via new helper `resolveEventSchema`) using `(type, schemaVersion?)`.
     - When `schemaVersion` is omitted, the latest active version is used and stamped onto the envelope before enqueueing.
   - Payload is validated against the resolved schema. Validation failures surface to the caller.
   - Envelope metadata gains `metadata.__apphubSchema = { version, hash }`.

3. **Ingress Integration**
   - Worker re-validates the payload against the registry (guarding against out-of-date inline publishers).
   - Persist `schema_version` and `schema_hash` on the stored row.
   - Reject events referencing unknown / deprecated versions with a retriable error so publishers can update.

4. **Observability**
   - `/health` shows the latest schema registry sync timestamp and lists event types missing schemas.
   - Prometheus counters for validation success / failure.
   - Set `APPHUB_EVENT_SCHEMA_ENFORCE=1` in environments where events without registered schemas should be rejected.

## CLI

`npm run register:event-schema --workspace @apphub/core -- <schema.json>`:

- Wraps the admin endpoint.
- Computes the schema hash and auto-increments the version when omitted.

## Backward Compatibility

- Publishers that omit `schemaVersion` will automatically pick up the latest active schema; they simply need access to the registry endpoint.
- Existing events without schema fields will continue to ingest with `NULL` schema metadata until validations are enforced flag-gated.
