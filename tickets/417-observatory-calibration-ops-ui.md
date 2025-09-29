# Ticket 417 – Extend Observatory Dashboard for Calibration Operations

## Summary
Upgrade the observatory dashboard/service to manage calibration uploads, surface reprocessing plans, and give operators control over when and how recalculations run.

## Background
Current UI lets users browse reports and dashboards but offers no calibration visibility. Once calibration import, ingest, and planning workflows exist, operators need a front door to upload new files, inspect derived plans, and initiate reprocessing without juggling curl scripts.

## Tasks
1. Add HTTP endpoints/UI panels for:
   - Uploading calibration files (writes to Filestore `calibrationsPrefix`).
   - Listing calibration records with version history (Metastore query).
   - Viewing generated reprocessing plans with partition counts/status.
   - Initiating reprocess runs (selective or "process everything"), delegating to orchestration workflow.
2. Secure endpoints via existing auth/principal model and log audit events (include calibration/version identifiers).
3. Show run progress and completion summaries by querying catalog run APIs and plan artifacts.
4. Update client to poll/stream status at reasonable intervals, respecting capacity hints exposed by orchestration.
5. Refresh documentation with operator walkthroughs and screenshots where applicable.
6. Add integration tests (or mocked service tests) verifying upload, plan display, and trigger flows.

## Acceptance Criteria
- Operators can upload calibrations, see them listed, inspect pending plans, and kick off reprocessing from the dashboard.
- UI communicates expected workload sizes and shows progress/alerts for failures.
- Documentation explains calibration management flow end-to-end.
- Tests cover the new endpoints/UI behaviours.

## Dependencies
- Tickets 413–416 for calibration config, ingestion, and orchestration features.

## Owners
- Examples experience team with frontend support.
