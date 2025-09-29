# Ticket 203: Propagate Run Keys to Queues, Runners, and Telemetry

## Problem
Run keys need to accompany runs through the queue, job runner, and observability stack to be useful for triage. Today queue job IDs, Docker workspace paths, event bus metadata, and metrics only reference the UUID. Without propagation, operators cannot correlate alerts or container logs by the friendly key, defeating the initiative.

## Proposal
- Update queue payloads and job IDs to include run key segments while preserving UUID fallback for uniqueness.
- Pass run key to workflow worker context so orchestration logs, alerts, and emitted events (`workflow.run.*`) expose both identifiers.
- Modify Docker runner workspace naming and telemetry to prefer sanitized run keys; keep existing UUID path as safety net when sanitization collapses.
- Ensure event bus metadata and metrics exporters emit run key fields, updating schemas and dashboards accordingly.
- Add compatibility checks so consumers ignoring the new field continue functioning.

## Deliverables
- Queue + worker code changes carrying run key alongside run ID.
- Docker runner telemetry and workspace updates with tests covering sanitization edge cases.
- Event schema updates (shared packages) and documentation for analytics teams.
- Observability changes: logger fields, alert payloads, and metrics naming where appropriate.

## Risks & Mitigations
- **Identifier collisions in sanitized context:** Retain UUID fallback and append suffixes when sanitized run keys clash; add logging for visibility.
- **Consumer breakage:** Coordinate schema changes with downstream consumers, providing dual fields during transition and version bumps in shared packages.
- **Telemetry noise:** Audit log/metric cardinality impacts before rollout; cap label value lengths and document guidelines for dashboards.
