# Environmental Observatory Service Manifest

This manifest registers the observatory file watcher service so operators can launch it from the AppHub UI. It now also includes a lightweight dashboard that renders the latest observatory reports so you can confirm the ingest loop visually. The watcher project lives under `examples/environmental-observatory/services/observatory-file-watcher` and the dashboard under `examples/environmental-observatory/services/observatory-dashboard`, both pre-configured to point at the example dataset paths.

## Services

| Slug | Description | Notes |
| --- | --- | --- |
| `observatory-file-watcher` | Watches `examples/environmental-observatory/data/inbox` for new minute CSV files and triggers the `observatory-minute-ingest` workflow. | Runs `npm run dev` inside `examples/environmental-observatory/services/observatory-file-watcher` and exposes `/healthz` + `/api/stats` on `http://127.0.0.1:4310`. |
| `observatory-dashboard` | Serves the latest observatory status report with automatic refresh. | Runs `npm run dev` inside `examples/environmental-observatory/services/observatory-dashboard` and exposes `/` + `/api/status` on `http://127.0.0.1:4311`. |

## Environment

Update `CATALOG_API_TOKEN` with an operator token that has `workflows:run` scope. Other variables point at the example dataset and determine how files are batched:

- `FILE_WATCH_STAGING_DIR`, `FILE_ARCHIVE_DIR`, and `FILE_WATCH_WAREHOUSE_PATH` resolve relative to the watcher working directory (`examples/environmental-observatory/services/observatory-file-watcher`).
- `OBSERVATORY_WORKFLOW_SLUG` defaults to `observatory-minute-ingest` but can be overridden if you register a forked ingest workflow.
- `FILE_WATCH_MAX_FILES` and `FILE_WATCH_VACUUM` flow directly into the ingest workflow parameters.
- `REPORTS_DIR` resolves relative to the dashboard working directory (`examples/environmental-observatory/services/observatory-dashboard`) and should match the report publisher output path.
- `OBSERVATORY_AUTO_COMPLETE` controls whether the watcher keeps tracking drops after launch (defaults to `true`).

Import this manifest through the service manifest importer or place it under one of the configured manifest lookup directories so the catalog loads it automatically.
