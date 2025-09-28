# Timestore Schema Evolution Runbook

## Overview
- Ingestion now classifies schema updates as `identical`, `additive`, or `breaking` using a compatibility checker.
- Additive changes append new columns to the active manifest without forking, and promote the manifest to the new schema version automatically.
- Breaking changes are rejected during ingestion and require a managed migration before writes resume.

## Authoring Additive Changes
- Extend the ingestion payload with the new fields and optional `schema.evolution` block:
  - `schema.evolution.backfill` (boolean) flags whether a backfill should be requested.
  - `schema.evolution.defaults` supplies per-column defaults for the backfill flow.
- Compatible writes reuse the existing manifest, update `manifest.metadata.schemaEvolution`, and emit `timestore.schema.evolved`.
- Older partitions are surfaced with the new columns filled to `NULL`, so readers always receive a consistent column set.

## Handling Breaking Changes
- Ingestion raises a `SchemaEvolutionError` when columns are dropped or types change.
- Follow the provided migration plan:
  1. Pause ingestion for the dataset and snapshot affected manifests.
  2. Rewrite or regenerate partitions to match the target schema (for example via a bespoke export/import job).
  3. Publish a fresh manifest pointing at the migrated partitions and resume ingestion.
- Document the migration steps in the dataset's run history so operators can audit the change.

## Backfill Workflow
- When `schema.evolution.backfill` is `true`, ingestion emits `timestore.schema.backfill.requested` with `addedColumns` and default values.
- Operations can subscribe to that event to trigger a lifecycle workflow that rewrites historic partitions or enqueues manual recovery jobs.
- Track the request via `manifest.metadata.schemaEvolution` (`requestedBackfill: true`) to avoid duplicate runs.

## Verification Checklist
- Confirm the manifest still reports a single shard entry and `schemaVersionId` advanced as expected.
- Run a query that selects the new column across the evolution boundary and verify historic partitions return `NULL` while new partitions return data.
- Ensure Redis and lifecycle workers observe the new events if automated backfill is configured.
