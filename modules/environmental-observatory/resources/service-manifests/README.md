# Environmental Observatory (Event-Driven) Service Manifest

This manifest registers the supporting services for the event-driven observatory walkthrough:

| Slug | Description | Notes |
| --- | --- | --- |
| `observatory-dashboard` | Serves observatory reports plus the aggregate visualization. | Runs from `modules/environmental-observatory/resources/services/observatory-dashboard` and listens on `http://127.0.0.1:4311`. |
| `observatory-admin` | React admin surface for calibration uploads and plan management. | Runs from `modules/environmental-observatory/resources/services/observatory-admin` and listens on `http://127.0.0.1:4322`. |

Environment variables are minimal because the services load the scratch config file (default `${OBSERVATORY_DATA_ROOT}/config/observatory-config.json`) and the admin UI can read defaults from `VITE_API_BASE_URL` / `VITE_API_TOKEN`:

- `OBSERVATORY_CONFIG_PATH` (optional) – explicit path to the generated config if you do not want to rely on the default discovery.
- `PORT` / `HOST` – standard Fastify binding options.
- `DASHBOARD_REFRESH_MS` – polling interval for the dashboard.
- `VITE_API_BASE_URL` / `VITE_API_TOKEN` – seed values for the admin UI connection form (falls back to `http://localhost:4000` and an empty token).

Import the manifest through the core UI or copy it into your manifest directory once the config file exists. The services do not prompt for inbox/staging/report paths anymore; they resolve the shared configuration file instead.
