# Environmental Observatory Service Manifest

This manifest registers the observatory ingest watcher service so operators can launch it from the AppHub UI. It now also includes a lightweight dashboard that renders the latest observatory reports so you can confirm the ingest loop visually. The watcher project lives under `services/filestore-ingest-watcher` and the dashboard under `examples/environmental-observatory/services/observatory-dashboard`, both pre-configured to point at the example dataset paths.

## Services

| Slug | Description | Notes |
| --- | --- | --- |
| `filestore-ingest-watcher` | Watches `examples/environmental-observatory/data/inbox`, streams files into MinIO via Filestore, and triggers the `observatory-minute-ingest` workflow. | Runs `npm run dev --workspace @apphub/filestore-ingest-watcher` and exposes `/healthz` + `/status` on `http://127.0.0.1:4310`. |
| `observatory-dashboard` | Serves the latest observatory status report with automatic refresh. | Runs `npm run dev` inside `examples/environmental-observatory/services/observatory-dashboard` and exposes `/` + `/api/status` on `http://127.0.0.1:4311`. |

## Environment

Update `CATALOG_API_TOKEN` with an operator token that has `workflows:run` scope. Other variables point at the example dataset and determine how files are batched:

- `WATCH_ROOT` and `WATCH_ARCHIVE_DIR` resolve relative to the repository root and should point at the example inbox/archive directories under `examples/environmental-observatory/data`.
- `FILESTORE_BASE_URL`, `FILESTORE_BACKEND_ID`, and `FILESTORE_TARGET_PREFIX` configure how uploads land in Filestore/MinIO. The default backend id is `1` when using `npm run dev:minio` and the provided config script (`npm run obs:event:config`).
- `WATCH_CONCURRENCY`, `WATCH_DELETE_AFTER_UPLOAD`, and other watcher-specific settings flow directly into the ingest parameters prepared for `observatory-minute-ingest`.
- `REPORTS_DIR` resolves relative to the dashboard working directory (`examples/environmental-observatory/services/observatory-dashboard`) and should match the report publisher output path.



Import this manifest through the service manifest importer or place it under one of the configured manifest lookup directories so the catalog loads it automatically.
