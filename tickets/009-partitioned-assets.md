# Ticket 009: Comprehensive Partition Support for Workflow Assets

## Problem Statement
Our asset system treats each workflow output as a single logical record keyed only by the workflow slug. Many workflows actually produce families of artifacts (e.g., CSV exports per customer or per date) that are distinguished by parameters. Without partitions, we either lose per-slice lineage and freshness or have to generate ad-hoc asset keys that explode the catalog and break stability guarantees. We need first-class partition support so a single asset definition can manage repeatable slices tied to run parameters.

## Goals
- Allow workflow asset definitions to declare a partition specification (time-based, static lists, or dynamic discovery).
- Accept an optional partition key when launching runs and persist it on asset materializations, including stored metadata such as file paths.
- Track status, freshness, and lineage per partition key so downstream assets can consume aligned slices.
- Provide APIs and scheduler/backfill utilities to enumerate partitions, request runs per key, and retry failures in isolation.
- Surface partition information through existing asset/read APIs so operators can query latest runs per key.

## Non-Goals / Out of Scope
- No new UI visualizations for partitions in this ticket (API/worker changes only).
- No support for multi-dimensional partitioning; a single partition dimension per asset is sufficient for now.
- No changes to how workflow steps produce artifacts beyond returning existing `result.assets` payloads.

## Implementation Sketch
1. **Schema & Domain Modeling**
   - Extend asset definition schema to include an optional `partitioning` block describing type (`timeWindow`, `static`, `dynamic`) and configuration (key format, enumerator, seed list).
   - Update persistence to store `partitionKey` alongside existing asset materialization records and index it for fast lookups.
   - Capture run metadata (artifact file name, storage URL) keyed by `assetId + partitionKey`.
2. **Workflow Launch & Validation**
   - Allow `enqueueWorkflowRun` (and related APIs) to accept a `partitionKey` when the target asset is partitioned.
   - Enforce validation that supplied keys match the asset’s partition spec (date-format parsing, membership checks, or allow-once for dynamic types).
3. **Partition Enumeration & Scheduling**
   - Implement partition enumerators per type: daily rolling range for time-based, configured arrays for static, persistence-backed discovery for dynamic (append-only).
   - Update scheduler/backfill jobs to iterate over partition keys, plan runs, and record completion status per key.
   - Support selective retries by partition key, keeping inflight dedupe scoped to `(workflow, partitionKey)`.
4. **APIs & Observability**
   - Add REST/GraphQL endpoints (or extend existing ones) to list partitions, view their latest run outcome, and inspect metadata.
   - Emit structured logs/events that include `partitionKey` so downstream consumers and metrics can aggregate per slice.
5. **Migrations & Backwards Compatibility**
   - Write database migration to add `partition_key` columns with sensible defaults for existing rows.
   - Provide a backfill script to populate historical partition data where possible (e.g., derive from parameters or leave null for legacy runs).

## Deliverables
- Updated asset definition schema, validation, and documentation covering partition configuration.
- Persistence and model changes for storing `partitionKey` and partition-scoped metadata.
- Scheduler/backfill updates to iterate and operate on partition keys.
- API enhancements (or new endpoints) for listing partitions and inspecting their status.
- Tests covering partition validation, run recording, and scheduler behavior per key.
- A migration plan with applied SQL/Prisma changes and backfill script if required.

## Acceptance Criteria
- Assets can declare a partitioning strategy; APIs reject runs that omit required keys or supply invalid ones.
- Materialized assets persist `partitionKey` and related metadata, and querying latest materialization can be scoped to a specific key.
- Scheduler/backfill can enqueue and complete runs across a range of partition keys, with independent retry tracking.
- Observability/logging includes partition keys, enabling operators to audit per-slice runs.
- Documentation explains how to configure partitions and how downstream consumers should request aligned keys.

## Open Questions
- How should dynamic partitions be garbage-collected or compacted when they grow unbounded?
- Do we need a default retention policy for per-partition metadata (e.g., keep last N runs)?
- Should partition discovery be pluggable (e.g., driven by querying external systems) beyond initial dynamic support?

## Dependencies
- Existing workflow definition storage and asset lineage persistence.
- Scheduler/backfill infrastructure and event bus used for run orchestration.

## Estimated Effort
- ~5-7 developer days including migrations, scheduler work, and testing.
