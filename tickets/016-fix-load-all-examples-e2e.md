# Ticket 016: Fix loadAllExamples.e2e.ts regression

## Problem
`examples/tests/catalog/loadAllExamples.e2e.ts` fails after removing the persisted service-config workflow because workflow definitions from the examples repository no longer satisfy the catalog's `workflowDefinitionCreateSchema`. The schema expects job steps to omit manifest-only fields and currently rejects time-window partitioning granularity values such as `minute`. As a result, the example workflows cannot be imported during the test run.

## Impact
- `npx tsx examples/tests/catalog/loadAllExamples.e2e.ts` now aborts with a 400 status.
- Example-driven onboarding flows break until the schemas or example definitions are reconciled.

## Proposed Direction
- Extend `workflowDefinitionCreateSchema` so time-window partitioning supports minute granularity (and any other lower-interval values required by the observatory examples).
- Audit the example workflow JSON (e.g. `examples/environmental-observatory/workflows/observatory-hourly-ingest.json`) against the updated schema and trim any manifest-only keys that the API legitimately rejects.
- Ensure `workflowStepSchema` tolerates workflow job steps without the persisted manifest fields (such as `storeResultAs`) when imported programmatically.
- Re-run `examples/tests/catalog/loadAllExamples.e2e.ts` to confirm the test passes without reintroducing config persistence.
