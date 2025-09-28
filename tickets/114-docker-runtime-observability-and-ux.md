# Ticket 114: Improve Observability for Docker Job Runs

## Problem
Operationalising Docker jobs requires visibility into container logs, exit status, resource usage, and data transfer metrics. The current job context structures assume sandbox telemetry and won’t automatically capture Docker-specific signals, leaving operators blind when containers fail.

## Proposal
- Extend the Docker runner to stream stdout/stderr into job logs and optionally persist tail logs in `JobRun.context`.
- Record structured metrics: container duration, exit code/signal, bytes downloaded/uploaded, size of staged inputs/outputs, and retry counts.
- Update `mergeJsonObjects` usage to include Docker telemetry alongside existing sandbox metrics so downstream dashboards remain consistent.
- Surface Docker-specific error details (image tag, command, last logs) when runs fail or time out.
- Add documentation for operators explaining where to find Docker logs and how to correlate them with Filestore outputs.

## Deliverables
- Runner instrumentation emitting structured telemetry and attaching it to job completion records.
- Unit tests verifying telemetry payloads and error contexts.
- Updates to any monitoring/export layers that expect sandbox-specific fields (ensure they handle Docker gracefully).
- Documentation updates and potentially CLI helpers to fetch run telemetry.

## Risks & Mitigations
- **Data overload:** Cap stored log payloads and provide truncation markers to avoid bloating run records.
- **Metric compatibility:** Keep schema consistent with existing dashboards; version new fields if necessary.
- **Privacy/Security:** Scrub sensitive values from logs/metrics before persisting.
