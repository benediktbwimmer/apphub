# Title
Core workflow asset recovery pipeline

## Context
Recent MinIO outages caused ingest and dashboard workflows to fail indefinitely because missing files and timestore partitions never reappeared. Module-level retries could not resolve the gaps, leaving 404 responses from Filestore and DuckDB HEAD errors in Timestore. Recovery logic currently lives in modules and lacks shared semantics across AppHub services.

## Problem
- Workflow steps surface generic `CapabilityRequestError`s, so the orchestrator cannot distinguish missing assets from transient network failures.
- Produced assets do not carry enough provenance for the core services to regenerate them automatically.
- When storage resumes, failing steps retry the same work, but upstream assets (inbox CSVs, staging bundles, timestore partitions) remain absent. Operators must manually re-trigger multiple workflows to heal the pipeline.

## Proposal
Implement first-class asset recovery in core services:
1. **Typed capability errors** – update module SDK and core job runtime to classify `NODE_NOT_FOUND`, S3 HEAD failures, and related responses as `asset_missing` with structured metadata.
2. **Asset provenance tracking** – persist producing workflow/step metadata for each declared asset so the core knows how to rebuild it.
3. **Recovery manager** – new core component that, given an `asset_missing` failure, schedules the workflow/job that produced the missing asset and tracks recovery progress.
4. **Orchestrator integration** – modify workflow executor/orchestrator to call the recovery manager on `asset_missing`, pause the failing step until recovery completes, then retry automatically.
5. **Telemetry** – surface recovery attempts/failures through admin APIs and metrics.

## Scope
- Core services (`services/core`) and shared SDK packages.
- Environmental observatory module should work out-of-the-box once recovery lands, but no module-specific code in this ticket.

## Out of Scope
- Rewriting module workflows.
- Building UI visualisations beyond basic metrics counts.
- Handling permanently corrupt data (recovery will retry a bounded number of times and then surface a clear error).

## Deliverables
- Typed errors exposed by module SDK capabilities and consumed by core job runtime.
- New asset provenance persistence and recovery manager.
- Orchestrator changes so steps with missing assets trigger automatic rebuilds.
- Metrics/logging documenting recovery activity.
- Automated tests covering outage-recovery scenarios.

## Acceptance Criteria
- Simulated MinIO outage: once storage returns, affected ingest and dashboard workflows recover without manual intervention.
- Admin queue-health shows decreased delayed count once recovery runs complete.
- Recovery attempt/failure metrics available for monitoring.
- No regressions in existing workflow behaviour when recovery is disabled.

## Testing Plan
- Unit tests for error classification, provenance reads/writes, and recovery scheduling.
- Integration test that removes an inbox CSV mid-run and verifies the core regenerates it and the workflow succeeds.
- Integration test that deletes a timestore partition, ensuring the recovery manager replays the loader and the dashboard aggregation step finishes.
- Manual validation guide: simulate MinIO downtime, restart it, observe automatic healing through logs and admin endpoints.

## Risks & Mitigations
- **Infinite recovery loops**: track attempts in recovery metadata and cap retries with alerts.
- **Performance overhead**: use asynchronous recovery jobs and short backoff retries to avoid blocking worker threads.
- **Provenance integrity**: add migration scripts and backfill routines to populate provenance for existing assets before enabling auto-recovery in production.

## Dependencies
- Requires schema migrations for provenance tracking.
- Coordination with observability team to expose new metrics.

## Timeline Suggestion
- Week 1: error typing + provenance persistence
- Week 2: recovery manager & orchestrator integration
- Week 3: metrics, tests, rollout docs
