# Ticket 412 – Eliminate Local Filesystem Dependencies in Event-Driven Observatory

## Summary
The Environmental Observatory (event-driven) example still relies on repo-local directories (`stagingDir`, `archiveDir`, `reportsDir`, etc.) even though jobs should only use sandbox scratch space. Several jobs write directly under `examples/environmental-observatory-event-driven/data/**`, making the scenario non-portable and inconsistent with sandbox guarantees.

## Current Issues
- `observatory-minute-ingest` passes `stagingDir` / `archiveDir` and the inbox normalizer writes CSVs to local staging before moving files in Filestore.
- `observatory-timestore-loader` expects those staged files on disk to read normalized CSVs.
- Visualization, report publisher, and dashboard aggregator jobs render artifacts to local plots/reports directories.
- Dashboard service serves HTML/JSON by reading local files instead of the Filestore artifacts.
- No guard prevents new code from writing outside scratch.

## Desired Outcome
- Jobs rely solely on Filestore/Metastore (plus ephemeral scratch) and no longer require predefined local directories.
- Workflows drop directory parameters; any temporary files live under scratch and are cleaned up.
- Visualization/report/dashboard artifacts are uploaded to Filestore and referenced via URLs/paths rather than filesystem locations.
- Dashboard service streams artifacts via Filestore client/HTTP.
- Sandbox enforces “scratch-only writes” during job execution.
- Docs/tests reflect the simplified configuration.

## Tasks
1. **Workflow & Trigger cleanup** – remove directory defaults/requirements, adjust triggers accordingly.
2. **Jobs** – refactor inbox normalizer, timestore loader, visualization runner, report publisher, and dashboard aggregator to operate via Filestore + scratch only.
3. **Dashboard service** – consume artifacts via Filestore, drop filesystem expectations, refresh UI copy.
4. **Config/docs** – remove leftover directory references or clarify they are Filestore prefixes; update README/docs.
5. **Sandbox enforcement** – add guard that rejects writes outside scratch (e.g., `/tmp/apphub-*`); document the rule.
6. **Tests** – update e2e flows, add regression for scratch guard, ensure no artifacts remain under repo data paths after runs.

## Acceptance Criteria
- Running the example leaves no artifacts in `examples/environmental-observatory-event-driven/data/**`.
- Aggregate + per-instrument artifacts live in Filestore and the dashboard renders them successfully.
- Jobs attempting to write outside scratch fail with a clear error.
- Updated docs/tests pass.

## Related
- Removal of event gateway & migration to per-job observatory events.
- Dashboard aggregation work.

## Owners
- Examples experience team (primary)
- Catalog/runtime team for sandbox enforcement guidance.
