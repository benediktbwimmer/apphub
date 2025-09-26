# Ticket 038: Wire Filestore Events Pipeline via Redis

## Problem Statement
Filestore needs to broadcast change notifications so Metastore, Timestore, and the UI can react. We already rely on Redis pub/sub and BullMQ across services; introducing another broker (Kafka) would add needless complexity. Currently no event schema or publisher exists for filestore.

## Goals
- Define event payloads (`filestore.node.created`, `filestore.node.updated`, `filestore.node.deleted`, `filestore.command.completed`, `filestore.drift.detected`) consistent with the existing catalog event bus conventions.
- Implement a Redis-backed publisher/subscriber module (mirroring `services/catalog/src/events.ts`) that can operate in inline mode for tests when `FILESTORE_EVENTS_MODE=inline` or `REDIS_URL=inline`.
- Emit events after successful command commits and when drift/watchers detect changes, including journal IDs and node metadata.
- Expose a WebSocket bridge (optional, similar to catalog) or extend the existing event forwarder to include filestore channels for the frontend.
- Document how Metastore and Timestore can subscribe, including example consumer snippets.

## Non-Goals
- Implementing downstream consumers (covered in Ticket 040) or CLI subscriptions.
- Persisting events to Postgres beyond the existing journal.

## Implementation Sketch
1. Create `events.ts` within filestore service using IORedis with resilience fallbacks identical to catalog.
2. Register event emission hooks in the orchestrator and watcher modules.
3. Update service config/env docs with channel names (default `apphub:filestore`), inline vs. redis mode flags, and authentication for WebSocket exposure.
4. Add tests verifying events emit in inline mode and with Redis (using `ioredis-mock` or a real Redis in CI) and that subscribers receive them.

## Acceptance Criteria
- Filestore publishes events to Redis and can fall back to in-process dispatch when Redis is unavailable.
- Events include enough context (node ID, path, backend, version, command, journal ID) for downstream systems to act.
- WebSocket bridge (if implemented) integrates with existing event gateway so the frontend can listen without extra services.
- Metrics/logging capture publish failures; no Kafka dependency is introduced.
