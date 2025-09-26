# File Drop Watcher Scenario

The file drop watcher showcases how an external service can orchestrate AppHub workflows. It watches a filesystem directory for new files, launches the `file-drop-relocation` workflow to move each drop into an archive, and surfaces live progress through a minimal dashboard.

## Components

| Component | Description |
| --- | --- |
| `examples/file-drop/services/file-drop-watcher` | Fastify service that watches the configured directory using `chokidar`, triggers the workflow, and serves `/api/stats` + a dashboard UI. |
| `examples/file-drop/jobs/file-relocator` | Example job bundle that moves a single file to the archival directory while emitting a JSON summary. |
| `file-drop-relocation` workflow | Orchestrates the relocation job and calls back into the watcher service when the job completes. |
| `examples/file-drop/data` | Sample inbox/archive directory tree for local demos. |

## Running the Demo

1. Start the core services (`npm run dev` from the repository root).
2. Install dependencies for the watcher service and start it:

   ```bash
   cd examples/file-drop/services/file-drop-watcher
   npm install
   FILE_WATCH_ROOT=$(pwd)/../../catalog/data/examples/file-drop/inbox \
   FILE_ARCHIVE_DIR=$(pwd)/../../catalog/data/examples/file-drop/archive \
   CATALOG_API_TOKEN=dev-ops-token \
   npm run dev
   ```

   The dashboard becomes available at <http://127.0.0.1:4310/>. Adjust `CATALOG_API_BASE_URL` if your catalog API listens elsewhere.

3. Import the example job and workflow via the frontend importer (activate the **File drop relocation** example scenario). This uploads the `file-relocator@0.1.0` bundle and registers the workflow.
4. Drop a file into `examples/file-drop/data/inbox`. Within a couple of seconds the watcher enqueues the workflow run, relocates the file into `archive/`, and the dashboard updates the recent activity table.

## Workflow Definition Summary

```mermaid
flowchart TD
  Watcher([File drop watcher]) -->|POST /workflows/file-drop-relocation/run| RelocationWorkflow((file-drop-relocation))
  RelocationWorkflow -->|Job| FileRelocator[[file-relocator]]
  FileRelocator -->|Moves file| Archive[(Archive dir)]
  RelocationWorkflow -->|Service step| Watcher
```

- **Step 1** (`relocate` job): Executes the `file-relocator` bundle with parameters supplied by the watcher (source path, archive root, drop ID).
- **Step 2** (`notify` service): Calls `POST /api/drops/:dropId/complete` on the watcher, passing the relocation summary so the dashboard can update metrics.

## Environment Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `FILE_WATCH_ROOT` | `examples/file-drop/data/inbox` | Directory to monitor for new files. |
| `FILE_ARCHIVE_DIR` | `examples/file-drop/data/archive` | Root directory for relocated files. |
| `FILE_DROP_WORKFLOW_SLUG` | `file-drop-relocation` | Workflow triggered when a new file arrives. |
| `FILE_WATCH_STRATEGY` | `relocation` | Launch behaviour. Set to `observatory` to trigger the environmental observatory ingest workflow. |
| `FILE_WATCH_STAGING_DIR` | Derived from `FILE_WATCH_ROOT` | Observatory mode: destination staging directory passed to the ingest workflow. |
| `FILE_WATCH_WAREHOUSE_PATH` | Derived from `FILE_WATCH_ROOT` | Observatory mode: DuckDB path passed to the ingest workflow. |
| `FILE_WATCH_MAX_FILES` | `64` | Observatory mode: upper bound for files processed per hour. |
| `FILE_WATCH_VACUUM` | `false` | Observatory mode: whether the DuckDB loader should run `VACUUM` after appends. |
| `FILE_WATCH_AUTO_COMPLETE` | `true` when strategy = `observatory` | Auto-mark runs as completed after launch (observatory mode uses this to avoid callback wiring). |
| `CATALOG_API_BASE_URL` | `http://127.0.0.1:4000` | Catalog API origin used to trigger runs. |
| `CATALOG_API_TOKEN` | _required_ | Operator token with `workflows:run` scope. |
| `FILE_WATCH_RESUME_EXISTING` | `true` | When enabled, queue files that already exist in the watch directory on startup. |
| `FILE_WATCH_DEBOUNCE_MS` | `750` | Stabilisation window for filesystem events. |
| `FILE_WATCH_MAX_ATTEMPTS` | `3` | Retry attempts when launching the workflow fails. |
| `PORT` / `HOST` | `4310` / `0.0.0.0` | Network binding for the watcher service. |

## Extending the Scenario

- Add a second workflow step that post-processes relocated files (e.g., extracting archives) and extend the watcher callback payload to show downstream metrics.
- Toggle the watcher retry parameters to simulate transient API outages and observe how the dashboard tracks retries.
- Wire the watcher into a cloud storage bucket (via `aws-sdk` or `gcsfs`) instead of a local directory for more realistic ingest pipelines.

## Using the Watcher for the Environmental Observatory Example

Reuse the watcher to trigger the `observatory-minute-ingest` workflow automatically whenever instruments drop new minute CSVs into the inbox. From the repository root:

```bash
cd examples/file-drop/services/file-drop-watcher
npm install

FILE_WATCH_ROOT=$(pwd)/../../catalog/data/examples/environmental-observatory/inbox \
FILE_WATCH_STAGING_DIR=$(pwd)/../../catalog/data/examples/environmental-observatory/staging \
FILE_ARCHIVE_DIR=$(pwd)/../../catalog/data/examples/environmental-observatory/archive \
FILE_WATCH_WAREHOUSE_PATH=$(pwd)/../../catalog/data/examples/environmental-observatory/warehouse/observatory.duckdb \
FILE_DROP_WORKFLOW_SLUG=observatory-minute-ingest \
FILE_WATCH_STRATEGY=observatory \
CATALOG_API_TOKEN=dev-ops-token \
npm run dev
```

The watcher batches files by minute, triggers the ingest workflow with the correct parameters, and marks runs as completed after launch so the dashboard stays tidy. Processed inbox files land in `archive/<instrument>/<hour>/<minute>.csv`, keeping replays idempotent. Combine this with the steps in `docs/environmental-observatory-workflows.md` to see the ingest → DuckDB → visualization → report pipeline operate end-to-end.

> Tip: the repository ships a ready-made service manifest at `examples/environmental-observatory/service-manifests/service-manifest.json`. Import it via the catalog UI to register the watcher with these settings—the importer now prompts for the inbox/staging/archive/warehouse paths (prefilled with defaults) and an operator API token so you don't have to edit JSON by hand.
