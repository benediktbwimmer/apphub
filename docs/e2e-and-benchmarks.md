# End-to-End Smoke Tests & Benchmarks

The repository ships a full-stack smoke test and lightweight benchmark harness that exercise the environmental observatory scenario via the published OpenAPI contracts.

## Prerequisites
- Docker Engine for launching Postgres, Redis, and MinIO
- Node.js environment with workspace dependencies installed (`npm install`)
- Local ports `5432`, `6379`, `9000`, `4000`, `4100`, `4200`, and `4300` available

Set `APPHUB_E2E_SKIP_STACK=1` if you want to reuse an already running container stack instead of letting the harness manage Docker Compose lifecycle.

## Smoke Test
```
npm run e2e
```
The runner:
- Builds and starts the AppHub services alongside Postgres, Redis, and MinIO via `docker compose`
- Materialises the observatory example configuration and deploys bundles/workflows with the generator schedule disabled
- Drives the Core, Filestore, Metastore, and Timestore services through their OpenAPI endpoints to verify health and a generator workflow run

Services are published on high ports (`4400`, `4410`, `4420`, `4430`) so the smoke test can run alongside a local `npm run dev` session without fighting for the default development ports.

All processes are torn down automatically unless `APPHUB_E2E_SKIP_STACK=1` is set.

## Benchmark Suite
```
npm run bench
```
The benchmark harness reuses the same bootstrapping flow, warms the observatory pipeline with a manual generator run, and records latency statistics for a curated set of read-heavy API calls across services. Results are written to `benchmarks/observatory.json` with average, min/max, and p95 timings for each scenario.

You can inspect console output for a quick summary or compare JSON snapshots between runs to watch for regressions.
