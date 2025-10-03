# Workflow run diffing and replay support

## Context
- The runs surface (`apps/frontend/src/runs/RunsPage.tsx:1`) lists executions but lacks tooling to compare runs or inspect parameter/output drift.
- Backend routes in `services/core/src/routes/workflows.ts:1` return run details yet do not expose diff endpoints or replay helpers.
- Operators currently retrigger runs blindly, risking repeated failures without insight into configuration changes.

## Impact
- Troubleshooting regressions or flaky runs is slow because engineers must manually scrape logs and reconstruct payloads.
- Manual retries can introduce inconsistent parameters, especially when workflows rely on dynamic inputs or run keys.
- Without contextual diffs, support teams struggle to communicate incident timelines and recovery steps.

## Proposed direction
1. Extend workflow persistence (`services/core/src/db/workflows.ts`) to snapshot run inputs/outputs and expose comparison queries.
2. Add REST endpoints to fetch diff data and recommended replay payloads (e.g. `GET /workflows/runs/:id/diff?compareTo=`).
3. Update the runs page with a compare modal that highlights parameter/output changes and run key conflicts.
4. Introduce a "Replay with prior inputs" action that re-enqueues runs using the recorded payload, with guardrails for stale assets.
5. Cover new behaviour with backend tests and Vitest UI specs to ensure diffs render reliably.

## Acceptance criteria
- Operators can request a diff between two workflow runs showing parameters, context, outputs, and status transitions.
- Runs UI supports comparing runs and rerunning with prior inputs while warning about drifted assets.
- Backend offers audited replay endpoints and snapshots required for diffing without leaking secrets.
- Documentation in `docs/` explains how to use diff/replay tooling during incident response.
