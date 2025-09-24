# Environmental Observatory Service Manifest

This manifest registers the observatory file watcher service so operators can launch it from the AppHub UI. It reuses the existing `services/examples/file-drop-watcher` project, pre-configured to point at the environmental observatory inbox, staging, and DuckDB paths.

## Services

| Slug | Description | Notes |
| --- | --- | --- |
| `observatory-file-watcher` | Watches `services/catalog/data/examples/environmental-observatory/inbox` for new hourly CSV files and triggers the `observatory-hourly-ingest` workflow. | Runs `npm run dev` inside `services/examples/file-drop-watcher` and exposes `/healthz` + `/api/stats` on `http://127.0.0.1:4310`. |

## Environment

Update `CATALOG_API_TOKEN` with an operator token that has `workflows:run` scope. Other variables point at the example dataset and determine how files are batched:

- `FILE_WATCH_STRATEGY=observatory` enables hour-based batching.
- `FILE_WATCH_STAGING_DIR` and `FILE_WATCH_WAREHOUSE_PATH` resolve relative to the watcher working directory (`services/examples/file-drop-watcher`).
- `FILE_WATCH_AUTO_COMPLETE=true` marks runs as completed immediately after launch, keeping the watcher dashboard tidy.

Import this manifest through the service manifest importer or place it under one of the configured manifest lookup directories so the catalog loads it automatically.
