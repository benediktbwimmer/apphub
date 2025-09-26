# Ticket 030: Author Filestore Architecture RFC

## Problem Statement
Timestore and Metastore now anchor temporal insights and flexible metadata, but there is no shared contract for discovering, mutating, or monitoring files that live on local volumes or S3 buckets. Teams mutate directories directly, which bypasses Postgres rollups, leaves Redis-driven events out of sync, and prevents Metastore from staying authoritative about file tags. We need an agreed architecture before implementation begins.

## Goals
- Document how a dedicated `services/filestore` Fastify service will expose filesystem APIs, reuse the existing Postgres cluster, and publish change events over Redis (no Kafka) so downstream systems stay consistent.
- Define the core data model (`nodes`, `snapshots`, `journal_entries`, `rollups`, `backends`), execution flow (command → executor → transaction → event), and caching strategy aligned with our BullMQ + Redis tooling.
- Capture integration boundaries with Metastore (metadata overlay) and Timestore (temporal change timelines), including event payload shapes and shared IDs.
- Outline operational requirements: auth, observability, failure handling, reconciliation strategy for out-of-band changes, and local dev ergonomics (`npm run dev` alongside catalog/metastore/timestore).

## Non-Goals
- Building code or migrations; this is an RFC / technical design artifact.
- Re-litigating storage backends beyond the committed Postgres + Redis stack.
- Defining UI surfaces; focus on service-to-service contracts and worker flows.

## Deliverables
- New `docs/filestore.md` (or similar) capturing the architecture, cross-service interactions, and phased rollout plan.
- Sequence/state diagrams highlighting Redis pub/sub usage, BullMQ job handling for heavy operations, and Postgres transaction boundaries.
- Updated `docs/architecture.md` summary section referencing Filestore and its relationship to Timestore/Metastore.
- Open questions + decision log to unblock subsequent tickets.

## Acceptance Criteria
- Architecture doc reviewed by platform + infra maintainers with sign-off recorded in the ticket.
- Design explicitly calls out Redis (pub/sub + BullMQ) as the shared eventing substrate—no Kafka dependencies introduced.
- RFC enumerates MVP scope vs. follow-ups so later tickets can trace to named milestones.
- Risks and mitigation strategies (e.g., drift detection, S3 eventual consistency, Postgres contention) are captured and assigned follow-up owners.
