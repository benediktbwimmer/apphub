# Environmental Observatory (Event-Driven) Service Manifest

This manifest registers the the supporting dashboard service for the event-driven observatory walkthrough:

| Slug | Description | Notes |
| --- | --- | --- |
| `observatory-dashboard` | Serves observatory reports plus the aggregate visualization. | Runs from `examples/environmental-observatory-event-driven/services/observatory-dashboard` and listens on `http://127.0.0.1:4311`. |

Environment variables are minimal because both services load `.generated/observatory-config.json`:

- `OBSERVATORY_CONFIG_PATH` (optional) – explicit path to the generated config if you do not want to rely on the default discovery.
- `PORT` / `HOST` – standard Fastify binding options.
- `DASHBOARD_REFRESH_MS` – polling interval for the dashboard.

Import the manifest through the catalog UI or copy it into your manifest directory once the config file exists. The services do not prompt for inbox/staging/report paths anymore; they resolve the shared configuration file instead.
