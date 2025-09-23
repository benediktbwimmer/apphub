# Directory Insights Workflow

This runbook captures the exact steps needed to publish the directory scanning and visualization bundles, register their jobs, and create the `directory-insights-report` workflow inside the running catalog API. Follow it any time the container image is reset or when you need to re-seed a fresh environment.

## Prerequisites
- The catalog service is running (inside the `apphub` container or via `npm run dev`).
- You have an operator token with `job-bundles:write`, `jobs:write`, and `workflows:write` scopes (`example-operator-token-123` from the default config works).
- Node 20+ and the repository source tree are available (already true inside the container at `/app`).
- Commands below assume execution from the repository root.

## 1. Package the Job Bundles
Two job bundles live under `job-bundles/`:

- `scan-directory`: recursively walks a directory, collecting per-file, per-extension, and per-depth metrics with truncation safeguards.
- `generate-visualizations`: consumes the scan output and emits an HTML dashboard, JSON dataset, and Markdown summary (bundle version `0.1.1`).

Rebuild both bundles so the artifacts and checksums are fresh:

```bash
npx tsx apps/cli/src/index.ts jobs package job-bundles/scan-directory --force
npx tsx apps/cli/src/index.ts jobs package job-bundles/generate-visualizations --force
```

The commands regenerate `artifacts/*.tgz` and matching `.sha256` files referenced by the publish payloads in the next step.

## 2. Publish Bundles to the Registry
Use the REST API to publish each artifact. The helper JSON payloads below embed the manifest and base64 data produced by the previous step.

```bash
curl -X POST http://127.0.0.1:4000/job-bundles \
  -H 'Authorization: Bearer example-operator-token-123' \
  -H 'Content-Type: application/json' \
  --data @tmp/scan-bundle-request.json

curl -X POST http://127.0.0.1:4000/job-bundles \
  -H 'Authorization: Bearer example-operator-token-123' \
  -H 'Content-Type: application/json' \
  --data @tmp/visualization-bundle-request.json
```

> The `tmp/*.json` payloads were generated during development with a short Node script that lifts the manifest, artifact tarball, and checksum into publishable JSON. Regenerate them the same way if you rebuild the bundles from scratch.

Successful responses include `bundle.slug` (`scan-directory` / `generate-visualizations`) and versions `0.1.0` / `0.1.1`.

## 3. Register Job Definitions
The catalog must know how to invoke each bundle. POST the following definitions to `/jobs`.

### 3.1 Directory Scan Job

```bash
curl -X POST http://127.0.0.1:4000/jobs \
  -H 'Authorization: Bearer example-operator-token-123' \
  -H 'Content-Type: application/json' \
  --data @tmp/scan-job-definition.json
```

Key notes:
- `entryPoint` pins the bundle: `bundle:scan-directory@0.1.0#handler`.
- `parametersSchema` enforces `scanDir` and optional `maxEntries` (default `20000`).
- `storeResultAs` (declared later in the workflow) will expose the job result under `shared.scanResults`.

### 3.2 Visualization Job

```bash
curl -X POST http://127.0.0.1:4000/jobs \
  -H 'Authorization: Bearer example-operator-token-123' \
  -H 'Content-Type: application/json' \
  --data @tmp/visualization-job-definition.json
```
The visualization job now returns an object containing `{ files: [...], count }`, which plays nicely with Postgres JSON storage while still exposing the artifact list.

Highlights:
- Requires `outputDir` and the nested `scanData` object.
- Defaults `reportTitle` to “Directory Visualization Report.”
- Declares an output shape matching the artifact metadata returned by the bundle.
- `entryPoint` pins the bundle: `bundle:generate-visualizations@0.1.1#handler`.

Verify with `curl http://127.0.0.1:4000/jobs -H 'Authorization: Bearer example-operator-token-123'`—the list should include both slugs.

## 4. Create the Workflow Definition
Register the composed workflow that wires the two jobs together:

```bash
curl -X POST http://127.0.0.1:4000/workflows \
  -H 'Authorization: Bearer example-operator-token-123' \
  -H 'Content-Type: application/json' \
  --data @tmp/directory-workflow-definition.json
```

Important fields inside the payload:
- Workflow slug `directory-insights-report` and version `1`.
- Parameters require `scanDir` (source directory) and `outputDir` (destination for artifacts); optional `maxEntries`, `reportTitle` carry through.
- Step `scan` runs `scan-directory`, storing its JSON result in `shared.scanResults`.
- Step `report` depends on `scan`, forwards shared data via `"{{ shared.scanResults }}"`, and stores the visualization response under `shared.visualization` (files land in `shared.visualization.files`).

Confirm definition:

```bash
curl http://127.0.0.1:4000/workflows/directory-insights-report \
  -H 'Authorization: Bearer example-operator-token-123'
```

The response should echo the DAG (`scan` → `report`) and default parameters.

## 5. Run the Workflow (Smoke Test)
Trigger a manual run once the steps above succeed:

```bash
curl -X POST http://127.0.0.1:4000/workflows/directory-insights-report/run \
  -H 'Authorization: Bearer example-operator-token-123' \
  -H 'Content-Type: application/json' \
  --data '{
    "parameters": {
      "scanDir": "/workspace/project",
      "outputDir": "/workspace/report-output",
      "maxEntries": 50000,
      "reportTitle": "Project Directory Insights"
    }
  }'
```

Inspect progress and outputs via:

- `GET /workflow-runs/:id` for overall status.
- `GET /workflow-runs/:id/steps` to confirm both jobs succeeded.

The workflow result aggregates shared values, so the final run payload includes `result.visualization.files` (HTML report, JSON data set, Markdown summary) alongside the scanning metrics. The runtime also writes those artifacts to the `outputDir` supplied in the parameters.

## 6. Maintenance Notes
- Re-run steps 1–4 whenever bundle code changes (bump bundle versions and update the job `entryPoint` strings accordingly).
- The workflow is manual-only by design; schedule triggers can be added later by extending the `triggers` array.
- If you need to cleanly remove the workflow, delete dependent runs first, then call `DELETE /workflows/:slug`.

With these steps executed, the platform can produce a full directory insight report on demand and the workflow catalog exposes the artifact list via the API and UI.
