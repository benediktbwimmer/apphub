# Environmental Observatory End-to-End Test

The repository ships a reusable end-to-end harness that stands up the complete AppHub stack, deploys the environmental observatory module, and exercises the full ingest → timestore → dashboard → report pipeline.

## Prerequisites
- Docker Engine (≥ 20.10) for Postgres, Redis, MinIO, and the AppHub services defined in `docker/observatory-e2e.compose.yml`
- Node.js workspace with dependencies installed (`npm install`)
- Local high ports `4400`, `4410`, `4420`, `4430`, and `9400` available

## Running the test
```bash
npm run e2e
```
The script:
- Builds the observatory module so fresh bundles, deployment code, and manifests are available
- Boots the Docker Compose stack unless `APPHUB_E2E_SKIP_STACK=1`
- Deploys the module via `apphub module deploy`, materialising configuration in a temporary scratch directory
- Triggers the synthetic generator workflow and waits for ingest, aggregation, and publication workflows to complete
- Verifies Filestore/Timestore output and proxies health checks for the dashboard and admin services through the Core API
- Captures container logs and fails if error-level entries are found. Logs are persisted to `logs/observatory-e2e.log` for inspection

### Useful environment variables
- `APPHUB_E2E_SKIP_STACK=1` — reuse an existing stack instead of calling `docker compose up`
- `APPHUB_E2E_OPERATOR_TOKEN` — override the default bearer token (`apphub-e2e-operator`)
- `APPHUB_E2E_CORE_PORT`, `APPHUB_E2E_FILESTORE_PORT`, etc. — remap published ports if defaults conflict with your environment

### Cleaning up
When the harness launches the stack it automatically runs `docker compose down --volumes` during teardown. If you bring your own stack, set `APPHUB_E2E_SKIP_STACK=1` so the harness leaves existing containers untouched.

### Logs and artifacts
Logs live in `logs/observatory-e2e.log`. Temporary configuration and data land under your system temp directory (`apphub-observatory-e2e-*`) and are removed automatically after the test finishes.
