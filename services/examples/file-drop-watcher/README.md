# File Drop Watcher Service

The file drop watcher observes a configurable directory for new files, launches the `file-drop-relocation` workflow for each drop, and exposes a lightweight dashboard with processing statistics.

## Development

```bash
npm install
FILE_WATCH_ROOT=$(pwd)/../../catalog/data/examples/file-drop/inbox \
FILE_ARCHIVE_DIR=$(pwd)/../../catalog/data/examples/file-drop/archive \
CATALOG_API_TOKEN=dev-ops-token \
CATALOG_API_BASE_URL=http://127.0.0.1:4000 \
npm run dev
```

The watcher serves its UI at <http://127.0.0.1:4310/> by default. Adjust `PORT` to bind to a different port.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `FILE_WATCH_ROOT` | `services/catalog/data/examples/file-drop/inbox` | Directory to watch for new files. Created automatically if missing. |
| `FILE_ARCHIVE_DIR` | `services/catalog/data/examples/file-drop/archive` | Root directory used by the relocation job when computing destination paths. |
| `FILE_DROP_WORKFLOW_SLUG` | `file-drop-relocation` | Workflow slug to trigger. |
| `CATALOG_API_BASE_URL` | `http://127.0.0.1:4000` | Fastify catalog API base URL. |
| `CATALOG_API_TOKEN` | — | Operator token with `workflows:run`. Required to launch relocation runs. |
| `FILE_WATCH_RESUME_EXISTING` | `true` | When truthy, enqueue existing files under the watch root at start-up. |
| `FILE_WATCH_DEBOUNCE_MS` | `750` | Debounce window applied when watching filesystem events. |
| `PORT` | `4310` | HTTP port for the watcher service UI and API. |
| `HOST` | `0.0.0.0` | Host interface to bind. |

## API Surface

- `GET /healthz` — liveness + readiness signal.
- `GET /api/stats` — JSON statistics covering observed drops, run attempts, and recent activity.
- `POST /api/drops/:dropId/complete` — invoked by the workflow service step to mark a run as completed.
- `GET /` — lightweight HTML dashboard summarising the watcher state.

## Workflow Notification Flow

1. `chokidar` observes a new file under `FILE_WATCH_ROOT`.
2. The watcher records a drop entry and triggers `POST /workflows/<slug>/run` with relocation parameters.
3. The workflow runs `file-relocator@0.1.0`, moving the file into the archive tree.
4. A service step in the workflow calls `POST /api/drops/:dropId/complete` with the relocation summary so the watcher can update its dashboard metrics.
