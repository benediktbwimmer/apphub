# Filestore Ingest Watcher

The filestore ingest watcher bridges legacy filesystem drops into the AppHub Filestore service. It observes a local directory with `chokidar`, uploads files into an S3-compatible bucket via the Filestore API (MinIO in development), and triggers downstream workflows once the upload succeeds. The service exposes `/healthz` and `/status` endpoints so operators can verify activity while testing ingest pipelines.

## Quick start

```bash
npm run dev:minio

WATCH_ROOT=$(pwd)/examples/environmental-observatory/data/inbox \
WATCH_ARCHIVE_DIR=$(pwd)/examples/environmental-observatory/data/archive \
FILESTORE_BASE_URL=http://127.0.0.1:4300 \
FILESTORE_BACKEND_ID=1 \
FILESTORE_TARGET_PREFIX=datasets/observatory/inbox \
npm run dev --workspace @apphub/filestore-ingest-watcher
```

Point `FILESTORE_BACKEND_ID` at an existing S3/S3-compatible backend mount (the observatory config generator creates one automatically). By default the watcher moves processed files into the archive directory; set `WATCH_DELETE_AFTER_UPLOAD=true` if you prefer to delete them instead.

## Configuration

| Variable | Purpose |
| --- | --- |
| `WATCH_ROOT` | Directory to monitor for new files. |
| `WATCH_ARCHIVE_DIR` | Local archive directory for processed files. |
| `FILESTORE_BASE_URL` | Filestore API base URL (defaults to `http://127.0.0.1:4300`). |
| `FILESTORE_BACKEND_ID` | Numeric backend mount id used for uploads. |
| `FILESTORE_TARGET_PREFIX` | Prefix inside the backend where files are written. |
| `WATCH_CONCURRENCY` | Maximum concurrent uploads (defaults to `4`). |
| `WATCH_DELETE_AFTER_UPLOAD` | When `true`, delete files instead of archiving them. |
| `PORT` / `HOST` | HTTP binding for `/healthz` and `/status` (defaults `4310` / `0.0.0.0`). |

The `/status` endpoint returns aggregated metrics plus the most recent uploads, making it simple to attach live dashboards or smoke tests.
