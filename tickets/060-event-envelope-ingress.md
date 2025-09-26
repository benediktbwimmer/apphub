# Ticket 060: Standardize Event Envelope & Ingress Pipeline

## Problem Statement
Workflow automation currently relies on asset freshness signals baked into the catalog scheduler. Other services (Timestore, Metastore, Filestore) emit ad-hoc Redis messages or rely on polling, so we lack a unified event stream that the new event-driven scheduler can consume. Without a consistent envelope, schema validation, and persistence layer, we cannot safely trigger workflows from arbitrary service events or inspect historical payloads for debugging.

## Goals
- Define a shared event envelope (type, source, occurredAt, payload, correlationId, ttl, metadata) and provide a TypeScript SDK for internal publishers.
- Stand up an `EventIngressWorker` (BullMQ) that accepts events, validates them against JSON Schema, and writes to a new `workflow_events` table.
- Surface ingress failures via DLQ metrics/logs and expose a lightweight admin query endpoint for debugging.
- Keep the existing WebSocket event stream in sync by fanning out accepted events.

## Non-Goals
- Building per-service publisher UIs (covered by later tickets).
- Implementing trigger evaluation or workflow launches (handled separately).
- Delivering cross-region replication for events beyond Postgres durability.

## Implementation Sketch
1. Create `packages/event-bus` with TypeScript definitions, schema validation helpers (Zod or Ajv), and a thin BullMQ publisher for internal services.
2. Add a migration for `workflow_events` capturing envelope fields, JSONB payload, and indexes on `type`, `source`, `occurred_at`.
3. Implement `EventIngressWorker` in `services/catalog` that consumes the BullMQ queue, validates events, persists them, republishes to WebSocket subscribers, and acknowledges or DLQs with structured logs.
4. Add API route `GET /admin/events` (internal scope) supporting filters (`type`, `source`, time range) for manual inspection during rollout.
5. Document publishing guidelines in `docs/events.md` and update service READMEs with the SDK usage instructions.

## Acceptance Criteria
- Services can publish events through the shared library and see them recorded in `workflow_events` with accurate metadata.
- Invalid payloads are rejected with clear logs and land in a DLQ; valid events are streamed to WebSocket clients.
- Admin endpoint returns recent events and supports pagination/filters.
- Documentation reflects the envelope contract and publishing steps for internal teams.
