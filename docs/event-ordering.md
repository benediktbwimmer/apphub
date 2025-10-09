# Event Ordering & Causality Plan

AppHub now mirrors workflow and domain events into Redpanda and begins landing them in time-series datasets. As we extend the pipeline to ClickHouse for downstream analytics, we need deterministic ordering guarantees to support replay, lineage, and causality analysis. This note captures the current behaviour, evaluates ordering strategies, and outlines the recommended implementation path.

## Current State

- **Central ingress** – All events (core services, HTTP proxy publishers, SDK clients) pass through `enqueueWorkflowEvent()`, persist in Postgres (`workflow_events`), and fan out to BullMQ trigger queues. Inserts run with a worker concurrency of five and rely on `occurred_at` (publisher supplied) plus `received_at` (ingest time) but no monotonic sequence.
- **Kafka mirror** – The mirror publishes JSON payloads with an `emittedAt` timestamp derived from `new Date()` (or `receivedAt` for custom workflow events), without Kafka partition/offset metadata, and often without an explicit message key (core domain events hash to random partitions).
- **Streaming consumers** – Timestore micro-batchers consume the mirrored topics, bucket rows into one-minute windows keyed by `emittedAt`, sort within a chunk by that same field, and write to DuckDB. The eventual ClickHouse pipeline will consume the same topics.
- **Identifiers** – Event IDs are UUIDv4 (non-orderable). Publishers can set `occurredAt`, but custom HTTP publishers frequently omit it, falling back to the ingest clock.

The result: order is effectively “best effort” — ingestion tends to be close to causal order, but clock skew, retry races, and topic partitioning can shuffle events. ClickHouse ingestion would inherit the same ambiguity.

## Ordering Requirements

1. Stable total order for every topic that survives replays and backfills.
2. Reconstructable event causality per workflow/job run (within and across topics).
3. Deterministic joins between Postgres history, Kafka mirrors, and ClickHouse tables.
4. Low publisher overhead — module authors should not manage clocks or sequencing.

## Options Considered

### Timestamp-Only Ordering

- **Approach**: Rely on `occurredAt` (publisher clock) with `receivedAt`/`emittedAt` as a tiebreaker.
- **Pros**: No schema changes; matches current payloads.
- **Cons**: Susceptible to clock skew, retry races, and concurrent worker commits. Multiple events can share identical timestamps, leaving the order undefined. ClickHouse merges from Kafka partitions would still need a deterministic secondary key.

### Vector or Version Clocks

- **Approach**: Attach Lamport clocks or vector clocks to every publisher/service and propagate them through envelopes.
- **Pros**: Captures partial ordering relationships explicitly, handles distributed publishers.
- **Cons**: Requires every publisher (including sandboxed modules) to manage clock state. Harder to retrofit, introduces storage overhead, and still needs a global tiebreaker for total ordering. Overkill while all events funnel through a single ingress path.

### Server-Assigned Ingestion Sequence (Recommended)

- **Approach**: Assign a monotonically increasing sequence (`ingress_sequence`) when the core service persists an event. Mirror that sequence (and the canonical ingest timestamp) into Kafka and downstream sinks. Use it as the total-order key, with `occurred_at` retained for domain semantics.
- **Pros**: Deterministic global order independent of client clocks or Kafka partitions. Simple to implement with a Postgres sequence. Keeps publisher APIs unchanged. Kafka consumers (Timestore, future ClickHouse loader) can sort deterministically using either `ingress_sequence` or `(partition, offset)` while still exposing causal timestamps.
- **Cons**: Requires schema migrations and updates to payload contracts. Reduces horizontal scalability if we ever bypass the core ingress path; would need a federated sequencing strategy in that future.

## Recommendation

Adopt the server-assigned ingestion sequence pattern and treat it as the primary ordering key across storage layers. Continue emitting `occurredAt` for domain semantics, but use `ingestedAt`/`ingressSequence` to recover deterministic order. Vector clocks are unnecessary with the current architecture and would add complexity without stronger guarantees.

## Implementation Plan

1. **Database sequence**
   - Add `ingress_sequence BIGINT GENERATED ALWAYS AS IDENTITY` (or an explicit sequence) to `workflow_events`.
   - Backfill existing rows by ordering on `(received_at, occurred_at, id)` to initialise the sequence deterministically.
   - Expose the column in `WorkflowEventRecord`, row mappers, and API responses (`/admin/events`, WebSocket stream).
2. **Publisher annotations**
   - When inserting a workflow event, persist `ingested_at` as `received_at` (already present) and capture the generated `ingress_sequence`.
   - Update `enqueueWorkflowEvent()` to return the enriched envelope so downstream callers can log the sequence if needed.
   - Allow the core service to source sequence numbers from a dedicated Postgres instance via `APPHUB_EVENT_SEQUENCE_DATABASE_URL`, falling back to the local sequence when unavailable.
3. **Kafka mirror payloads**
   - Include `ingressSequence`, `receivedAt`, and `occurredAt` fields in every mirrored message.
   - Set the Kafka message `timestamp` to `receivedAt` and use `ingressSequence` as the message key for topics that currently omit keys (core events), ensuring monotonic ordering per partition.
   - Record Kafka `partition` and `offset` in mirror diagnostics for troubleshooting.
4. **Streaming consumers**
   - Extend the Timestore batcher schemas to store `ingress_sequence`, `kafka_partition`, and `kafka_offset`.
   - Pass partition/offset metadata from the Kafka consumer into the row payload and sort chunks by `(ingress_sequence)` rather than `emittedAt`.
   - Update watermarks and backlog metrics to rely on `ingress_sequence` deltas.
5. **ClickHouse ingestion**
   - When building the ClickHouse loader, use the same `(ingress_sequence, kafka_partition, kafka_offset)` triad as the primary sorting key (e.g., `ORDER BY (ingress_sequence, kafka_partition, kafka_offset)`).
   - Retain `occurred_at`/`ingested_at` columns for temporal analysis; document the canonical sort order in materialised views.
6. **Validation & tooling**
   - Add integration tests that enqueue out-of-order timestamps and assert that API/Kafka/ClickHouse mock consumers observe the same total order.
   - Extend `/readyz` and `/admin/event-health` to surface the latest `ingress_sequence` replicated to Kafka and ClickHouse to detect lag.
7. **Documentation & rollout**
   - Update developer docs (`docs/events.md`, `docs/redpanda.md`) once the implementation lands, explaining the ordering contract and client expectations.
   - Provide a migration checklist (DB migration, mirror deployment, consumer schema updates) for staging/production rollout.

## Open Questions

- Do we need per-entity ordering (e.g., per workflow run) surfaced explicitly? If so, emit a derived `causality_key` (workflow run, job run, correlation ID) alongside the sequence.
- For future direct-to-Kafka publishers, we will need a sequencing service or to funnel through the core HTTP proxy to mint `ingress_sequence`. Capture this constraint in publisher guidelines.
- Validate ClickHouse storage engine expectations (e.g., `MergeTree` ordering) once the loader prototype is ready; adjust sorting keys if ingestion throughput requires sharding by partition.
