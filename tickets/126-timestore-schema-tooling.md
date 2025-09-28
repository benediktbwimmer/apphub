# 126 - Timestore Schema Migration Tooling & Governance

## Summary
Provide tooling and governance for incompatible schema changes (column type changes, drops). Implement offline migration workflow, validation, and rollout guardrails to ensure data consistency.

## Why
- Even with automatic additive support (Ticket 121), operators need safe procedures for breaking schema changes.
- Manual SQL updates risk data loss or split manifests.

## Scope & Constraints
- CLI/automation that: snapshots current schema, validates proposed change, generates migration plan.
- Support: rename column, change type with transform function, drop column with archival.
- Ensure read queries during migration see consistent data (feature flags or phased rollout).

## Deliverables
- Schema migration manifest format (YAML/JSON) describing intended changes and transformation hooks.
- Execution tool that runs migrations partition-by-partition, leveraging append/replace APIs.
- Validation steps (dry run, checksums, rollback plan).
- Governance policy: approvals, observability (metrics/logs).

## Success Criteria
- Breaking schema changes can be executed without downtime in staging.
- Tool surfaces validation failures before mutating data.
- Post-migration queries see consistent schema across partitions.

