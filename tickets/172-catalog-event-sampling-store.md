# Ticket 172: Catalog Event Sampling Persistence

## Problem Statement
With workflow metadata arriving on ingress events, the catalog service must persist lightweight samples that relate job steps to emitted events. Without durable storage, inferred edges would vanish between deploys and we could not measure sampling confidence.

## Goals
- Introduce a `workflow_event_producer_samples` table keyed by triggerable attributes (workflowDefinitionId, workflowRunStepId, jobSlug, eventType, eventSource).
- Normalize incoming metadata on ingest, increment sample counts, and capture `lastSeenAt` timestamps.
- Expose admin diagnostics to inspect sampling health (counts per job, stale entries).

## Non-Goals
- Build topology edges or UI renderers (covered elsewhere).
- Backfill historical data (separate ticket handles replay).
- Modify trigger evaluation behavior beyond passive recording.

## Implementation Sketch
1. Design and run a migration creating the sample table with composite keys and basic indexes; include cleanup columns for TTL processing.
2. Extend `workflowEvents.ts` / `eventIngressWorker.ts` to parse `metadata.__apphubWorkflow`, validate workflow/job IDs, and upsert sample rows using `ON CONFLICT` counters.
3. Add catalog metrics/logging for overflows or malformed metadata; surface a `/admin/event-sampling` snapshot for operators.
4. Write integration tests that ingest events with context and assert sample rows update as expected; cover inline queue mode to ensure code paths stay hot.

## Deliverables
- New Postgres migration plus catalog data access layer for the sampling table.
- Event ingress logic that records samples and logs validation failures.
- Admin endpoint or log output documenting sample counts, accompanied by test coverage.
