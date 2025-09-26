# Ticket 063: Wire Timestore, Metastore, and Filestore into Shared Event Bus

## Problem Statement
The new event-driven scheduler relies on a unified event pipeline, yet Timestore, Metastore, and Filestore each emit bespoke notifications (or none at all). Without aligning them on the shared envelope and queue, workflows cannot subscribe to dataset, metadata, or file lifecycle changes, and operators lose observability into cross-service triggers.

## Goals
- Update Timestore, Metastore, and Filestore services to publish standardized events through the shared event bus library.
- Cover key lifecycle events: dataset exported/partition closed, metastore record created/updated/deleted, filestore object created/updated/deleted.
- Ensure each publisher supplies correlation IDs where available and handles publish failures gracefully with retries and logging.
- Document event type catalog and payload schemas for downstream consumers.

## Non-Goals
- Adding new business events beyond the core lifecycle changes listed above.
- Guaranteeing exactly-once delivery; standard at-least-once semantics suffice.
- Building UI or workflow triggers (handled in other tickets).

## Implementation Sketch
1. Import the shared event bus library into each service (`services/timestore`, `services/metastore`, `services/filestore`) and configure the BullMQ connection via existing environment variables.
2. Identify lifecycle points (e.g., parquet export completion, metastore record persistence hooks, filestore mutation executor) and publish events after successful transactions.
3. Define per-event payload schemas (dataset identifiers, affected partitions, namespace/key pairs, file paths + metadata) and register them with the validation helper for local type checking.
4. Add retry logic/backoff for publish failures and structured logs when the event bus is unavailable.
5. Update service documentation (`docs/timestore.md`, `docs/metastore.md`, `docs/filestore.md`) with emitted event types, field descriptions, and examples.

## Acceptance Criteria
- All three services emit standardized events for the defined lifecycle actions, visible in `workflow_events` with correct metadata.
- Publishing errors surface via logs/metrics without interrupting the primary transaction; retries are attempted according to policy.
- Documentation enumerates the new events and payload structures for each service.
- Local tests or integration harnesses confirm events fire when lifecycle hooks execute.
