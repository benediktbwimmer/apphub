# Observatory Event Gateway

The event gateway tails the Filestore SSE stream and surfaces lightweight diagnostics for the event-driven observatory example. Instead of watching the filesystem directly, it:

- Loads the shared configuration file (`.generated/observatory-config.json`).
- Subscribes to `filestore.node.uploaded` / `filestore.node.moved` notifications to confirm uploads and archiving behaviour.
- Exposes `/status` and `/config` endpoints so you can verify which prefixes, datasets, and triggers are active.

A simple HTML front-end is not bundled (the dashboard lives in its own service); this gateway focuses on observability and health checking.

## Development

```bash
npm install
OBSERVATORY_CONFIG_PATH=$(pwd)/../../.generated/observatory-config.json \
PORT=4310 \
HOST=0.0.0.0 \
npm run dev
```

`OBSERVATORY_CONFIG_PATH` is optional as long as the script can discover the config in `.generated/`. The host/port values match the service manifest.

## API

| Route | Description |
| --- | --- |
| `GET /healthz` | Liveness probe; returns `{ status: 'ok', streamConnected: boolean }`. |
| `GET /status` | JSON payload with redacted config, rolling metrics (uploads, moves, archives), and the 50 most recent Filestore events. |
| `GET /config` | Sanitised snapshot of the shared configuration (tokens removed). |

## Metrics Tracked
- Total uploads, moves, and archive operations observed during the current process lifetime.
- Last upload + archive event (path + timestamp).
- Whether the SSE stream is currently connected and the last error message if not.

If the gateway loses the Filestore stream it retries automatically with a five-second backoff. Errors are logged to the console for quick diagnosis.
