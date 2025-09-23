# Workflow Assets & Lineage Overview

## Why Assets Matter
Workflow assets turn ad-hoc outputs into first-class records the catalog can index, audit, and reuse. When steps declare which named assets they produce or consume, every run automatically contributes to a shared lineage graph.

Key benefits:
- **Ownership & Dependencies:** Producers/consumers are captured for each asset, making it easy to see which steps (and workflows) emit or rely on a given dataset, report, or model.
- **Always-Fresh Snapshots:** The catalog records the latest payload, schema, freshness hints, producer step status, and run timestamps. Downstream automation can decide when to reuse or regenerate an asset based on declared TTLs or cadence.
- **History & Auditing:** Each production event is versioned; `/workflows/:slug/assets/:assetId/history` exposes prior payloads so you can diff outputs, trace regressions, or rebuild from a specific run.
- **Cross-Workflow Sharing:** Assets provide a contract between workflows. One workflow can `consume` an asset produced by another, and the orchestrator will ensure the dependency exists (or rerun the producer) before advancing.
- **Automation Hooks:** Structured metadata enables policy checks (e.g. fail deployments if an asset is stale), alerting when high-value assets change, or feeding dashboards with provenance data.

## Declaring Assets in Workflows
Inside a workflow definition, attach `produces` and `consumes` blocks to job steps:

```json
{
  "id": "report",
  "jobSlug": "generate-visualizations",
  "produces": [
    {
      "assetId": "directory.insights.report",
      "schema": {
        "type": "object",
        "properties": {
          "outputDir": { "type": "string" },
          "reportTitle": { "type": "string" },
          "generatedAt": { "type": "string", "format": "date-time" },
          "artifacts": {
            "type": "array",
            "items": { "type": "object" }
          }
        },
        "required": ["outputDir", "reportTitle", "generatedAt", "artifacts"]
      }
    }
  ]
}
```

At runtime your job handler should include an `assets` array in the returned result:

```ts
return {
  status: 'succeeded',
  result: {
    files: artifacts,
    assets: [
      {
        assetId: 'directory.insights.report',
        payload: {
          outputDir,
          reportTitle,
          generatedAt,
          artifacts: artifacts.map(({ relativePath, mediaType, sizeBytes }) => ({
            relativePath,
            mediaType,
            sizeBytes
          }))
        },
        producedAt: new Date().toISOString()
      }
    ]
  }
};
```

## Inspecting Assets via API
Once declared, the catalog exposes inventory and history endpoints:

- **List assets for a workflow**
  ```bash
  curl -sS http://127.0.0.1:4000/workflows/directory-insights-report/assets | jq
  ```
- **Fetch history for a specific asset**
  ```bash
  curl -sS http://127.0.0.1:4000/workflows/directory-insights-report/assets/directory.insights.report/history | jq
  ```

Each record includes producer/consumer step metadata, the most recent payload, schema, freshness hints, and the run/step identifiers that emitted it.

## Design Patterns
- Use structured payloads (rich JSON objects) so downstream consumers can extract metrics without hitting the filesystem.
- Include TTL or cadence in the schema if data freshness matters; the catalog stores these hints for monitoring.
- When migrating workflows, update `produces` declarations first so subsequent runs populate lineage immediately.
- Combine assets with queue-based automation: e.g. a release workflow can block until `directory.insights.report` is fresh, or trigger downstream jobs when an asset changes.
- Chain assets across workflows. The `directory-insights-archive` workflow (see `docs/directory-insights-archive-workflow.md`) consumes `directory.insights.report` and produces `directory.insights.archive`, making it easy to test event-driven materialization heuristics.

By treating workflow outputs as assets, you gain a built-in lineage system: reproducible artifacts, traceable provenance, and a queryable history that spans every workflow run.
