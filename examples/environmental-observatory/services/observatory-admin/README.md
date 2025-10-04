# Observatory Admin Service

A lightweight React admin surface that speaks directly to the AppHub API endpoints exposed for the environmental observatory example. Operators can:

- Upload calibration payloads into the Filestore calibration prefix.
- Inspect recent calibration snapshots.
- Review reprocessing plans and trigger selective reruns.

The UI runs outside the main AppHub frontend so the example can evolve independently.

## Development

```bash
cd examples/environmental-observatory/services/observatory-admin
npm install          # only required the first time
npm run dev
```

The dev server listens on `http://127.0.0.1:4322` by default. Configure the connection banner with an AppHub operator token and API base URL, or seed them via environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address for Vite dev server. |
| `PORT` | `4322` | Port for local development. |
| `VITE_API_BASE_URL` | `http://localhost:4000` | Default AppHub API base URL. |
| `VITE_API_TOKEN` | *(empty)* | Optional seed for the operator bearer token. |

The form persists credentials in `localStorage` (`observatory-admin-config`) so reconnecting to the same instance is quick.

## Build

```bash
npm run build
```

The build command runs `tsc --noEmit` followed by `vite build`. Ensure dependencies are installed before running the build.

## Notes
- API calls reuse the same JSON contracts as the original AppHub observatory page; all validation happens client-side before hitting the endpoints.
- Toast notifications are intentionally minimal and leverage lightweight, local components rather than the main frontend design system.
