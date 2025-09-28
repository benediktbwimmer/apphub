# 121 - Timestore Schema Evolution Strategy

## Summary
Design and implement first-class schema evolution support so datasets can evolve column definitions without dropping to new manifests for every change. Introduce schema version compatibility rules, automatic migration for additive changes, and reader-side handling for mixed-schema partitions.

## Why
- Frequent schema updates currently force new manifests, breaking append flows.
- Query planner/choreography must handle partitions with slightly different schemas.
- Smooth schema evolution is essential for long-lived datasets.

## Scope & Constraints
- Support additive column changes (new columns with defaults/nullability) automatically.
- Provide tooling for incompatible changes (column type change, drop) via migration workflow.
- Maintain manifest append behaviour for compatible evolutions.
- Update query planner and executor to reconcile schema differences (e.g., missing columns backfilled with nulls).

## Deliverables
- Schema compatibility checker and migration plan definitions.
- Update ingestion to detect compatible schema changes and reuse active manifest.
- Background job (or ingestion hook) to backfill new columns with defaults in prior partitions if requested.
- Planner/executor enhancements to union partitions with differing schema versions safely.
- Documentation + runbook for incompatible schema migrations.

## Success Criteria
- Ingestion no longer fails or branches manifests for additive schema changes.
- Queries spanning versions return consistent column sets.
- Operators have a guided flow for incompatible schema migrations.

