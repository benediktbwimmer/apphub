# 127 - Timestore Per-File Ingestion Regression Tests

## Summary
Add regression coverage to ensure multiple ingestion batches targeting the same partition window accumulate rows correctly and are surfaced through the query API.

## Why
- Current benchmark shows only the first per-file ingestion is visible when querying, suggesting a partition append or query regression.
- Existing tests only ingest a single payload (plus idempotent replay) and never assert aggregated results for multiple batches.
- Without automated coverage, per-file ingestion bugs can slip into production when workflows emit one CSV per instrument.

## Scope & Constraints
- Extend unit/integration tests under `services/timestore/tests` to ingest multiple batches for a shared partition key and confirm manifested row counts match the sum of all payloads.
- Add API-level coverage (using the query routes) that mirrors benchmark filters (timeRange + partition key filter) and asserts combined row counts.
- Include a regression covering mixed idempotency keys (unique per file) to ensure repeated batches append rather than overwrite or skip.
- Keep tests self-contained with embedded Postgres / local storage helpers already used in the suite.

## Deliverables
- New ingestion test that writes >=2 batches into the same `window` and validates manifest + partition metadata totals.
- New query test (or extension) that executes the `/datasets/:slug/query` handler after the multi-batch ingestion and asserts the expected row count and contents.
- Documentation/comments in the tests describing the per-file ingestion scenario to aid future maintainers.

## Success Criteria
- Running `npm run test --workspace @apphub/timestore` fails without the fix and passes with the new coverage in place.
- Query responses for the shared window return the cumulative rows (30 in the benchmark analogue) in automated tests.
- Future regressions in partition append logic or query filtering are caught by CI.
