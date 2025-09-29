# Ticket 201: Add `run_key` Column and Uniqueness Guardrails

## Problem
We cannot enforce human-readable run keys without persistence and collision control. The current `workflow_runs` table only stores an opaque `id`, so nothing stops duplicate business runs or enables lookups by semantic key. We need schema support plus a backfill plan that respects existing data volume and availability.

## Proposal
- Introduce nullable `run_key` and `run_key_normalized` columns on `workflow_runs` with index/constraint to prevent multiple `pending`/`running` runs sharing the same key per workflow definition.
- Write migration to populate new columns and partial unique index (e.g., unique on `(workflow_definition_id, run_key_normalized)` where status IN ('pending','running')).
- Create background script to backfill keys using available metadata: partition key, trigger dedupe key/correlation ID, or a generated slug when no context exists.
- Add safeguards to the script (batch windowing, retries, metrics) and document how to run it in staging and production.
- Update data access layer to project new fields and expose normalized key helper.

## Deliverables
- SQL migration file with forward/backward compatibility notes.
- Backfill utility under `scripts/` with dry-run option and Prometheus logging.
- Unit tests covering normalization and constraint behavior.
- Runbook entry describing operational rollout sequencing.

## Risks & Mitigations
- **Constraint churn during backfill:** Use partial index limited to active statuses and run the backfill before enforcing non-null requirement; delay NOT NULL until adoption is complete.
- **Key collisions from legacy runs:** Backfill script must detect duplicates and fall back to generated suffixes while logging anomalies.
- **Long-running migration:** Apply column additions and index creation concurrently-safe (CONCURRENTLY where available) and document downtime expectations.
