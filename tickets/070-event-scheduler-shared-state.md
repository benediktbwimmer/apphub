# Ticket 070: Persist Event Scheduler State

## Problem Statement
Event ingress and trigger workers currently rely on in-memory Maps for rate limits, pause windows, and metrics (see `eventSchedulerState.ts` / `eventSchedulerMetrics.ts`). When processes restart or scale horizontally, protections such as rate limiting, automatic trigger pauses, and health statistics reset, allowing duplicate deliveries and hiding operational issues. We need a durable, shared state layer so every worker enforces the same limits and the admin API reflects cluster-wide health.

## Goals
- Replace in-process Maps with a shared store (PostgreSQL tables, Redis structures, or both) for source rate limits, manual pauses, trigger failure windows, and evaluation metrics.
- Expose read/write helpers that the ingress worker, trigger processor, and `/admin/event-health` route share.
- Ensure state survives process restarts and supports multiple worker instances without duplicate launches or stale metrics.
- Provide clear migration steps and backfill for existing configurations (e.g., seed defaults on boot).

## Non-Goals
- Redesigning the event queue topology or delivery semantics.
- Adding new rate-limiting strategies beyond the existing window + pause model.
- Building user-facing configuration UIs (covered by future tickets).

## Implementation Sketch
1. Design durable schemas/structures for: source rate limits, manual pauses, trigger failure counters, and metric snapshots. Favor Postgres for auditability; consider Redis for hot counters if needed.
2. Refactor `eventSchedulerState.ts` and `eventSchedulerMetrics.ts` to use the shared store, adding helper modules and caching where appropriate.
3. Update ingress/trigger workers to fetch and update shared state atomically, guarding against race conditions when multiple workers act on the same trigger.
4. Adjust `/admin/event-health` to read from the new store and enrich responses with last-updated timestamps.
5. Write migrations, unit tests, and integration coverage that simulate multi-worker scenarios and restart recovery.

## Acceptance Criteria
- Restarting workers does not reset rate limit windows, trigger pauses, or metrics.
- Running two ingress/trigger workers in parallel enforces limits without double deliveries.
- `/admin/event-health` reflects cluster-wide state with timestamps.
- Tests cover persistence round-trips and concurrent updates on the shared store.
