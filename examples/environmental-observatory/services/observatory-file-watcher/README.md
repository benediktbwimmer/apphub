# Observatory File Watcher Service

This watcher is tailored for the environmental observatory example. It monitors the inbox for instrument CSV drops, groups files by minute timestamp, and triggers the `observatory-minute-ingest` workflow with all paths plus the Timestore dataset parameters required by the new ingestion job. A minimal dashboard at <http://127.0.0.1:4310/> shows recent launches and retry status so you can confirm new sensor data is being ingested.

## Development

```bash
npm install
FILE_WATCH_ROOT=$(pwd)/../../data/inbox \
FILE_WATCH_STAGING_DIR=$(pwd)/../../data/staging \
FILE_ARCHIVE_DIR=$(pwd)/../../data/archive \
TIMESTORE_BASE_URL=http://127.0.0.1:4200 \
TIMESTORE_DATASET_SLUG=observatory-timeseries \
TIMESTORE_DATASET_NAME="Observatory Time Series" \
CATALOG_API_TOKEN=dev-ops-token \
npm run dev
```

Adjust `CATALOG_API_BASE_URL`, `TIMESTORE_*`, `PORT`, or any optional overrides if your catalog API or Timestore instance runs elsewhere.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `FILE_WATCH_ROOT` | `examples/environmental-observatory/data/inbox` | Directory watched for instrument CSV files. |
| `FILE_WATCH_STAGING_DIR` | `examples/environmental-observatory/data/staging` | Minute subdirectories are created here before ingestion. |
| `FILE_ARCHIVE_DIR` | `examples/environmental-observatory/data/archive` | Passed to the normalizer so processed files are moved into `archive/<instrument>/<hour>/<minute>.csv`. |
| `TIMESTORE_BASE_URL` | `http://127.0.0.1:4200` | Base URL for the Timestore API used by the ingestion job. |
| `TIMESTORE_DATASET_SLUG` | `observatory-timeseries` | Dataset slug forwarded to the Timestore loader. |
| `TIMESTORE_DATASET_NAME` | `Observatory Time Series` | Friendly dataset name created on first ingest if it does not exist. |
| `TIMESTORE_TABLE_NAME` | `observations` | Logical table name used inside Timestore. |
| `TIMESTORE_STORAGE_TARGET_ID` | — | Optional storage target override; defaults to the service’s local target. |
| `TIMESTORE_API_TOKEN` | — | Optional bearer token for authenticating with Timestore. |
| `OBSERVATORY_WORKFLOW_SLUG` | `observatory-minute-ingest` | Workflow slug to trigger. Falls back to `FILE_DROP_WORKFLOW_SLUG` if set. |
| `FILE_WATCH_MAX_FILES` | `64` | Maximum CSV files forwarded to a single ingest run. |
| `FILE_WATCH_RESUME_EXISTING` | `true` | Queue files already present in the inbox on startup. |
| `FILE_WATCH_DEBOUNCE_MS` | `750` | Debounce window (ms) applied before treating a file as stable. |
| `FILE_WATCH_MAX_ATTEMPTS` | `3` | Launch retries before a drop is marked as failed. |
| `OBSERVATORY_AUTO_COMPLETE` | `true` | If truthy the watcher marks a drop as completed immediately after launch. |
| `CATALOG_API_BASE_URL` | `http://127.0.0.1:4000` | Catalog API endpoint used for workflow launches. |
| `CATALOG_API_TOKEN` | — | Operator token with `workflows:run` scope. |
| `PORT` | `4310` | HTTP port for the watcher UI. |
| `HOST` | `0.0.0.0` | Host interface to bind. |

## API Surface

- `GET /healthz` &mdash; liveness and watcher readiness.
- `GET /api/stats` &mdash; JSON snapshot covering configuration, metrics, and recent drops.
- `GET /` &mdash; Dashboard summarising minute partitions, run attempts, and recent errors.

## How It Works

1. `chokidar` watches the inbox and batches files that share the same `instrument_<id>_<YYYYMMDDHHmm>.csv` minute suffix.
2. When a minute receives new files the watcher launches `POST /workflows/{slug}/run` with parameters for the inbox, staging, archive paths, and all required Timestore configuration.
3. The ingest workflow normalises the files, writes structured rows into Timestore, and downstream jobs use the curated dataset to generate plots and status reports. The dashboard reflects launches instantly so you can confirm the ingest loop remains healthy.
