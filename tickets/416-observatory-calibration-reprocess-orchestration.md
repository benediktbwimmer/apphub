# Ticket 416 – Build Calibration Reprocessing Planner & Orchestrator

## Summary
Deliver tooling that enumerates partitions affected by new calibrations, lets operators review the blast radius, and automates triggering of downstream workflows in selectable or "process everything" modes.

## Background
After calibration updates we need the ability to re-run ingest and all downstream workflows. Today operators would have to manually queue individual minutes with no visibility into scope or scheduling constraints. A planner/orchestrator pair should bridge the gap by computing required work and scheduling runs with respect to capacity.

## Tasks
1. Implement a calibration planning job (`observatory-calibration-planner`) that:
   - Accepts calibration identifiers (instrument + effectiveAt).
   - Queries catalog assets/Metastore to find partitions whose calibration version differs.
   - Outputs a plan file (Filestore + optional `observatory.reprocess.plan` asset) listing affected minutes and downstream workflow cascade.
2. Create a reprocess orchestration workflow (`observatory-calibration-reprocess`) that consumes plan files and supports:
   - Operator-selected subset execution.
   - "Process everything" path with configurable concurrency/throttling.
   - Emitting progress updates/metrics.
3. Integrate with catalog APIs to queue `observatory-minute-ingest` runs using stored parameters (include calibration override hints) and rely on auto-materialize to fan out downstream work.
4. Ensure orchestrator tracks run status (success/failure) and updates Metastore/plan artifacts accordingly.
5. Add CLI or script helpers for generating plans and launching orchestrations.
6. Write end-to-end tests simulating calibration change → plan → reprocess pipeline.

## Acceptance Criteria
- Generating a plan for a calibration highlights all stale partitions with counts per workflow stage.
- Operators can trigger selective re-runs or full catch-up with bounded concurrency.
- Orchestrated runs update plan status and surface metrics/logs for monitoring.
- Tests validate the planner’s queries and orchestrator execution path.

## Dependencies
- Tickets 413–415 for calibration config, records, and ingest metadata.

## Owners
- Examples experience team and workflow runtime owners.
