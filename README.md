# Osiris AppHub

"YouTube of web applications" prototype that catalogs container-ready repositories, surfaces searchable metadata, and offers a keyboard-first tag experience.

## Project Layout

```
apphub/
├── docs/
│   └── architecture.md       # High-level system design + roadmap ideas
├── services/
│   └── catalog/              # Fastify-based API serving app metadata + tag autocomplete
└── apps/
    └── frontend/             # Vite + React search UI with tag-driven autocomplete
```

## Getting Started

### Catalog API

```bash
cd services/catalog
npm install
npm run dev
```

The API listens on `http://localhost:4000` by default and serves:
- `GET /apps` & `GET /apps/:id` for metadata search
- `GET /tags/suggest` for `key:value` autocomplete
- `POST /apps` for registering new repositories (creates a pending ingest job)
- `POST /apps/:id/retry` to manually requeue ingestion for an existing repository
- `GET /apps/:id/history` to inspect recent ingestion events and attempt counts
- `GET /services` to inspect dynamically registered auxiliary services and their health status

Metadata persists to a local SQLite database at `services/catalog/data/catalog.db`. Set `CATALOG_DB_PATH=/custom/path.db` if you want to relocate it.

### Ingestion Worker

Repository submissions land in a `pending` state until the ingestion worker clones the repo, verifies the `Dockerfile`, and enriches tags from project metadata.

Use `POST /apps/:id/retry` to manually requeue a failed repository; the UI offers a shortcut button once a repo is marked `failed`.

`GET /apps/:id/history` returns the latest ingestion events including status, message, attempt number, commit SHA (when available), and duration in milliseconds for deeper debugging.

```bash
cd services/catalog
npm run ingest
```

Ensure a Redis instance is running and reachable via `REDIS_URL` before starting the worker.

Configuration knobs:
- `REDIS_URL` — BullMQ connection string (default `redis://127.0.0.1:6379`).
- `INGEST_QUEUE_NAME` — queue identifier (default `apphub:repo-ingest`).
- `INGEST_CONCURRENCY` — number of concurrent repository ingests (default `2`).
- `INGEST_JOB_ATTEMPTS` / `INGEST_JOB_BACKOFF_MS` — retry policy for failed ingests (defaults `3` and `10000`).
- `INGEST_CLONE_DEPTH` — git clone depth (default `1`).

### Frontend

```bash
cd apps/frontend
npm install
cp .env.example .env.local    # Update if the API runs elsewhere
npm run dev
```

The Vite dev server binds to `http://localhost:5173`.

### Env Vars

`apps/frontend/.env.example`
```bash
VITE_API_BASE_URL=http://localhost:4000
```

Update as needed for different deployment targets.

`services/catalog` respects:

```bash
PORT=4000
HOST=0.0.0.0
CATALOG_DB_PATH=./data/catalog.db
REDIS_URL=redis://127.0.0.1:6379
INGEST_QUEUE_NAME=apphub:repo-ingest
INGEST_CONCURRENCY=2
INGEST_JOB_ATTEMPTS=3
INGEST_JOB_BACKOFF_MS=10000
INGEST_CLONE_DEPTH=1
SERVICE_MANIFEST_PATH=services/service-manifest.json   # Defaults to bundled manifest; comma-separated list supported
SERVICE_CONFIG_PATH=services/service-config.json       # Declarative service config + git imports (comma-separated list)
SERVICE_REGISTRY_TOKEN=                                # Shared secret for POST/PATCH /services (disabled when empty)
SERVICE_HEALTH_INTERVAL_MS=30000                       # Health poll cadence
SERVICE_HEALTH_TIMEOUT_MS=5000                         # Health request timeout
SERVICE_OPENAPI_REFRESH_INTERVAL_MS=900000             # How often to refresh cached OpenAPI metadata
```

### Service Configuration

The service registry consumes `services/service-config.json`, a declarative module file inspired by Go's dependency management system.
It can point at the bundled `service-manifest.json`, inline service definitions, and declare `imports` that pull additional
service manifests from Git repositories. Each import records the remote repository, an optional tag/branch `ref`, and an optional
`commit` SHA. The registry clones every module, walks the dependency DAG, and merges the resulting service entries with any extra
JSON manifests referenced via `SERVICE_MANIFEST_PATH`.

To add a new module at runtime, call `POST /service-config/import` with your `SERVICE_REGISTRY_TOKEN`. The API validates the
remote configuration, resolves the effective commit, appends the import to `services/service-config.json`, and refreshes the
registry in-place.

```bash
curl -X POST http://127.0.0.1:4000/service-config/import \
  -H "Authorization: Bearer $SERVICE_REGISTRY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "repo": "https://github.com/example/service-module.git",
        "ref": "v1.2.0"
      }'
```

The response includes the module identifier, resolved commit SHA, and number of discovered services.

### Run Everything Locally

From the repository root you can start Redis, the catalog API, the ingestion worker, and the frontend dev server in a single command:

```bash
npm install
npm run dev
```

This expects a `redis-server` binary on your `$PATH` (macOS: `brew install redis`). The script launches:
- Redis (`redis-server --save "" --appendonly no`)
- Catalog API on `http://127.0.0.1:4000`
- Ingestion worker
- Service orchestrator (`npm run dev:services`) that reads the bundled `services/service-manifest.json` (referenced by
  `services/service-config.json`) and spawns any configured dev commands
- Frontend on `http://localhost:5173`

Stop the stack with `Ctrl+C`.

### Docker Image

A single container image can run Redis, the catalog API, background workers, and the static frontend:

```bash
docker build -t apphub .
docker run \
  --rm \
  -p 4000:4000 \
  -p 4173:4173 \
  -p 6379:6379 \
  -v apphub-data:/app/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  apphub
```

Notes:
- The container exposes Redis on port `6379`; external services should point `REDIS_URL` at `redis://<host>:6379` (use `host.docker.internal` on macOS).
- Build and launch workers shell out to Docker, so the container needs the host Docker socket mounted at `/var/run/docker.sock`.
- `apphub-data` persists the SQLite catalog database; remove the volume for a clean slate.
- The compiled frontend is served from http://localhost:4173 and the API remains at http://localhost:4000. External service manifests are **not** bundled—load them dynamically through the API at runtime.

Stop the container with `Ctrl+C` or `docker stop` when running detached.

## Testing

End-to-end suite spins up the catalog API, BullMQ worker (using an in-memory Redis mock), and a temporary Git repository to verify the full ingestion loop:

```bash
cd services/catalog
npm run test:e2e
```

The script creates an isolated SQLite database, registers a sample repo, waits for ingestion to finish, and asserts that history events capture status transitions, attempt counts, commit SHA, and duration.

## Current Functionality

- Optional seeded catalog of sample web apps with tags like `framework:nextjs`, `category:media`, `runtime:node18`. Generate
  a local copy by loading `services/catalog/tests/fixtures/seeded-catalog.sql` into SQLite (e.g.
  `sqlite3 tmp.db < services/catalog/tests/fixtures/seeded-catalog.sql`) and point `CATALOG_DB_PATH` at the resulting file.
  The application now starts with an empty catalog by default.
- Tag-aware search (AND semantics) plus free-text filtering on app name/description.
- Keyboard-friendly autocomplete (`Tab` to accept, arrow keys to navigate, `Esc` to dismiss).
- Styled card grid highlighting repo link + Dockerfile path.
- Background ingestion worker (BullMQ + Redis) that clones pending repositories, validates `Dockerfile` presence, and augments tags via `package.json`, `tags.yaml`, and Dockerfile heuristics, surfacing failure diagnostics, attempt counts, and per-job metadata (duration + commit SHA) in the UI with manual requeue controls for failures.

## Next Steps

See [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md) for the living roadmap that outlines upcoming implementation, testing, and developer-experience work.

Highlighted priorities:

1. **Persistent Metadata Store** – Replace in-memory arrays with Postgres-ready migrations derived from the schema in `docs/architecture.md`.
2. **Repository Ingestion Pipeline** – Harden cloning, Dockerfile validation, and tag enrichment so the worker can promote repositories without manual intervention.
3. **Build & Runtime Orchestration** – Introduce a build worker that publishes images to an internal registry and expose preview URLs through the runner service.
4. **Enhanced Search** – Index descriptions and tags in Postgres or a dedicated search service (Meilisearch/OpenSearch) for fuzzy matches & ranking.
5. **User Features** – Profiles with customizable key bindings, saved collections, and launch history for power users.

## Open Questions

- Preferred identity+auth model (GitHub OAuth vs. platform-native accounts?).
- Resource limits + billing for running apps (timeouts, CPU/memory caps?).
- Multi-tenancy concerns: should every launch run in isolated namespaces (Kubernetes vs. lightweight Firecracker VMs)?
- Tag curation: manual only, or automated enrichment via language/framework detection?
- Governance for community submissions (moderation, abuse prevention, licensing checks?).
