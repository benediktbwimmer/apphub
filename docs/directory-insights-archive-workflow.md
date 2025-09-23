# Directory Insights Archive Workflow

This runbook adds a downstream workflow that consumes the `directory.insights.report` asset and produces a compressed archive in a second location. The archive workflow demonstrates cross-workflow asset dependencies and provides a concrete target for auto-materialization testing.

## Prerequisites
- The catalog service is running inside the `apphub` container and the asset system is enabled (see the base [Directory Insights Workflow](./directory-insights-workflow.md)).
- Bundle `generate-visualizations@0.1.2` and workflow `directory-insights-report` have been published and produce the `directory.insights.report` asset.
- An operator token with `job-bundles:write`, `jobs:write`, and `workflows:write` scopes (default: `example-operator-token-123`).
- Commands assume execution from the repository root on the host.

## 1. Package the Archive Job Bundle
The archive job lives in `job-bundles/archive-report`. Regenerate its artifact to pick up source edits:

```bash
npx tsx apps/cli/src/index.ts jobs package job-bundles/archive-report --force
```

The CLI writes `artifacts/archive-report-0.1.1.tgz` plus the matching `.sha256` checksum. Both files are required for publishing.

## 2. Publish Bundle & Register the Job
Publish the bundle via the catalog API and register a job definition that pins it:

```bash
curl -X POST http://127.0.0.1:4000/job-bundles \
  -H 'Authorization: Bearer example-operator-token-123' \
  -H 'Content-Type: application/json' \
  --data @tmp/archive-bundle-request.json

curl -X POST http://127.0.0.1:4000/jobs \
  -H 'Authorization: Bearer example-operator-token-123' \
  -H 'Content-Type: application/json' \
  --data '{
    "slug": "archive-report",
    "name": "Archive Directory Insights Report",
    "type": "batch",
    "runtime": "node",
    "entryPoint": "bundle:archive-report@0.1.1#handler",
    "timeoutMs": 120000,
    "parametersSchema": {
      "type": "object",
      "required": ["asset"],
      "properties": {
        "asset": { "type": "object" },
        "reportDir": { "type": "string" },
        "archiveDir": { "type": "string" },
        "archiveName": { "type": "string" }
      },
      "additionalProperties": false
    },
    "metadata": {
      "bundle": "archive-report@0.1.1",
      "category": "archival"
    }
  }'
```

> The helper payload `tmp/archive-bundle-request.json` mirrors the format used in the original runbook: embed the manifest JSON, base64 tarball, and checksum before invoking the `/job-bundles` endpoint.

If the job already exists, update it in place:

```bash
curl -X PATCH http://127.0.0.1:4000/jobs/archive-report \
  -H 'Authorization: Bearer example-operator-token-123' \
  -H 'Content-Type: application/json' \
  --data '{
    "entryPoint": "bundle:archive-report@0.1.1#handler",
    "metadata": {
      "bundle": "archive-report@0.1.1",
      "category": "archival"
    }
  }'
```

## 3. Register the Archive Workflow
Create the workflow definition that consumes the report asset and produces a new archive asset:

```bash
curl -X POST http://127.0.0.1:4000/workflows \
  -H 'Authorization: Bearer example-operator-token-123' \
  -H 'Content-Type: application/json' \
  --data @tmp/archive-workflow-definition.json
```

Example payload:

```json
{
  "slug": "directory-insights-archive",
  "name": "Directory Insights Archive",
  "description": "Compresses the directory insights report artifacts into a tarball.",
  "version": 1,
  "parametersSchema": {
    "type": "object",
    "required": ["reportAsset", "archiveDir"],
    "properties": {
      "reportAsset": { "type": "object" },
      "archiveDir": {
        "type": "string",
        "minLength": 1,
        "description": "Destination folder for generated archives"
      },
      "archiveName": {
        "type": "string",
        "minLength": 1,
        "description": "Optional override for the archive file name"
      }
    }
  },
  "steps": [
    {
      "id": "zip-report",
      "name": "Archive Report Artifacts",
      "type": "job",
      "jobSlug": "archive-report",
      "bundle": {
        "strategy": "pinned",
        "slug": "archive-report",
        "version": "0.1.1",
        "exportName": "handler"
      },
      "consumes": [
        { "assetId": "directory.insights.report" }
      ],
      "produces": [
        {
          "assetId": "directory.insights.archive",
          "schema": {
            "type": "object",
            "required": ["archivePath", "generatedAt", "artifactCount"],
            "properties": {
              "archivePath": { "type": "string" },
              "archiveDir": { "type": "string" },
              "archiveName": { "type": "string" },
              "sourceAssetId": { "type": "string" },
              "sourceOutputDir": { "type": "string" },
              "reportTitle": { "type": ["string", "null"] },
              "generatedAt": { "type": "string", "format": "date-time" },
              "artifactCount": { "type": "number" },
              "artifacts": { "type": "array" }
            }
          }
        }
      ],
      "storeResultAs": "archiveResult",
      "parameters": {
        "asset": "{{ parameters.reportAsset }}",
        "reportDir": "{{ parameters.reportAsset.outputDir }}",
        "archiveDir": "{{ parameters.archiveDir }}",
        "archiveName": "{{ parameters.archiveName }}"
      }
    }
  ]
}
```

If the workflow already exists, apply the same payload via:

```bash
curl -X PATCH http://127.0.0.1:4000/workflows/directory-insights-archive \
  -H 'Authorization: Bearer example-operator-token-123' \
  -H 'Content-Type: application/json' \
  --data @tmp/archive-workflow-definition.json
```

## 4. Run the Archive Workflow
1. Generate or refresh the upstream report asset (see `directory-insights-workflow.md`). Make note of the `archive` and `report` directories you supply.
2. Fetch the latest asset payload:
   ```bash
   REPORT_ASSET=$(curl -sS \
     http://127.0.0.1:4000/workflows/directory-insights-report/assets/directory.insights.report/history?limit=1 \
     | jq -c '.data.history[0].payload')
   ```
3. Build the request payload and trigger the workflow:
   ```bash
   jq -n --argjson report "$REPORT_ASSET" --arg archiveDir "/app/tmp/directory-insights/archives" \
     '{parameters:{reportAsset:$report, archiveDir:$archiveDir}}' > tmp/archive-run.json

   curl -sS -X POST http://127.0.0.1:4000/workflows/directory-insights-archive/run \
     -H 'Authorization: Bearer example-operator-token-123' \
     -H 'Content-Type: application/json' \
     --data @tmp/archive-run.json
   ```
4. Inspect the run and confirm that `archiveResult.archivePath` points to a `.tar.gz` file containing the original artifacts.

## 5. Verify the New Asset
List the archive asset and its history:

```bash
curl -sS http://127.0.0.1:4000/workflows/directory-insights-archive/assets | jq
curl -sS http://127.0.0.1:4000/workflows/directory-insights-archive/assets/directory.insights.archive/history | jq
```

The entries reference the upstream asset, enabling downstream auto-materialization tests (e.g., when `directory.insights.report` refreshes, auto-trigger the archive workflow).

## 6. Clean-Up
- Remove temporary payload files or environment variables that contain asset data.
- Periodically prune the archive directory if multiple runs accumulate tarballs.

With this workflow in place, you now have a chained asset: the initial report asset feeds a second workflow that produces `directory.insights.archive`, providing a realistic target for event-driven auto-materialization experiments.
