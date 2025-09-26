# Observatory Dashboard Service

The dashboard service renders the latest observatory status report and refreshes automatically so operators always see up-to-date metrics.

## Development

```bash
npm install
REPORTS_DIR=$(pwd)/../../data/reports \
PORT=4311 \
npm run dev
```

The dashboard listens on <http://127.0.0.1:4311/> by default. Adjust `PORT` or `HOST` to bind elsewhere.

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `REPORTS_DIR` | `examples/environmental-observatory/data/reports` | Directory containing report partitions (e.g. `2025-08-01T09-00/status.json`). |
| `PORT` | `4311` | HTTP port used by the dashboard. |
| `HOST` | `0.0.0.0` | Host interface to bind. |
| `DASHBOARD_REFRESH_MS` | `10000` | Client-side polling interval in milliseconds for refreshing report data. |

## Endpoints

- `GET /` renders the dashboard HTML shell. It loads the latest report and auto-refreshes on an interval.
- `GET /api/status` returns JSON describing the most recent report along with relative paths to the artefacts.
- `GET /reports/*` serves files from `REPORTS_DIR` (HTML, Markdown, JSON) with caching disabled so browsers always fetch the newest content.

On each refresh the dashboard reads `status.json` directly from disk, guaranteeing that the report view reflects the latest ingestion run without manual reloads or restarts.
