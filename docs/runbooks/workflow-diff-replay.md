# Workflow run diff and replay guide

The runs surface now captures every workflow execution along with the payloads that triggered it. Operators can compare prior runs to understand configuration drift and replay a run with its recorded inputs when they need to validate a fix.

## Compare two workflow runs

1. Open **Runs → Workflows**, select the run you want to investigate, and choose **Compare runs**.
2. Pick another run for the same workflow. The compare dialog highlights differences across:
   - **Parameters, context, and output** – field-by-field changes are shown with before/after snapshots.
   - **Status transitions** – ordered history events for each run so you can spot diverging retry paths.
   - **Asset snapshots** – differences in produced asset payloads or freshness metadata.
3. If the base run produced stale assets, a warning banner is shown so you can decide whether a replay will operate on outdated artefacts.

Use the diff to confirm whether a regression is caused by altered inputs, a failing step, or an unexpected retry path before triggering remediation.

## Replay a workflow run with prior inputs

1. From the run detail panel, click **Replay with prior inputs**.
2. The backend re-enqueues the workflow with the saved parameters, trigger payload, and partition key. No new run key is generated.
3. If the run produced assets that are currently flagged as stale, the request returns a warning instead of enqueueing immediately. Review the stale asset list and confirm the replay if the assets are safe to reuse.
4. A toast acknowledges success once the replay is accepted. Every replay is audited in the operator logs.

Replays always use the recorded payload – avoid editing live workflow defaults until the diff highlights the exact change needed.

## API endpoints

The core API now exposes the following routes:

- `GET /workflow-runs/:runId/diff?compareTo=<runId>` – returns serialized runs, execution history, asset deltas, and stale asset warnings.
- `POST /workflow-runs/:runId/replay` – enqueues a new run with the prior inputs. Include `{ "allowStaleAssets": true }` to bypass stale asset warnings once you have reviewed them.

Reference these endpoints from automation or CLI tooling when you need scripted diff exports or controlled replays.
