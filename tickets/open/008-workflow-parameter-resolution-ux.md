# Clarify workflow failure UX when parameter resolution fails

## Summary
- Steps that depend on upstream results are flagged as "failed" even if their job handlers never ran.
- This happens because the orchestrator resolves step parameters before dispatching the handler; when required data is missing the Zod schema fails, the step is marked failed, and the UI shows it alongside the upstream failure.
- The current presentation is confusing: it looks like the engine ran steps out of order when, in reality, it aborted during input resolution.

## Background
- Observed while debugging the observatory publication workflow. The `generate-plots` step failed early (`partitionWindow` missing), so the dependent `publish-reports` step saw `visualizationAsset = null` and threw a schema error.
- The workflow timeline rendered both steps as failed in the same attempt even though `publish-reports` never left parameter resolution.
- This pattern is baked into `services/core/src/workflow/executors.ts`: we always resolve parameters, run key, idempotency key, etc., before enqueuing/execing the handler.

## Problem
- Engineers interpret the timeline as "step B ran even though step A failed", leading to time spent questioning orchestration order instead of the real issue (missing upstream data).
- There is no visual distinction between "handler threw" and "parameter expansion failed".
- The step badge remains "Running" while the engine waits for the next retry window, even though the handler never started. This makes it look like work is stuck mid-execution when it actually failed during input resolution.
- Retry attempts spam the same schema error every few minutes because the dependencies remain null.

## Proposal
1. Track parameter-resolution failures separately from handler execution failures (e.g., store a `resolutionError` flag on the step attempt).
2. Surface that distinction in the UI: tooltip or status badge like "Awaiting upstream result" rather than "Failed" when inputs are missing, and avoid labeling the step as "Running" during this phase.
3. Optionally gate retries until upstream steps succeed, or provide guidance in the error message so engineers know to fix the prerequisite.

## Acceptance Criteria
- Workflow timelines clearly indicate when a step failed during parameter resolution vs. handler execution.
- Engineers can tell at a glance that downstream steps are blocked on upstream outputs instead of suspecting out-of-order execution.
- Documentation (or release notes) calls out the new behaviour so teams know what to expect.
