# Web App Atlas

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
```

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
- Frontend on `http://localhost:5173`

Stop the stack with `Ctrl+C`.

## Testing

End-to-end suite spins up the catalog API, BullMQ worker (using an in-memory Redis mock), and a temporary Git repository to verify the full ingestion loop:

```bash
cd services/catalog
npm run test:e2e
```

The script creates an isolated SQLite database, registers a sample repo, waits for ingestion to finish, and asserts that history events capture status transitions, attempt counts, commit SHA, and duration.

## Current Functionality

- Seeded catalog of sample web apps with tags like `framework:nextjs`, `category:media`, `runtime:node18` stored in SQLite.
- Tag-aware search (AND semantics) plus free-text filtering on app name/description.
- Keyboard-friendly autocomplete (`Tab` to accept, arrow keys to navigate, `Esc` to dismiss).
- Styled card grid highlighting repo link + Dockerfile path.
- Background ingestion worker (BullMQ + Redis) that clones pending repositories, validates `Dockerfile` presence, and augments tags via `package.json`, `tags.yaml`, and Dockerfile heuristics, surfacing failure diagnostics, attempt counts, and per-job metadata (duration + commit SHA) in the UI with manual requeue controls for failures.

## Next Steps

1. **Persistent Metadata Store** – Replace in-memory arrays with Postgres tables from the data model in `docs/architecture.md`.
2. **Repository Ingestion Pipeline** – Clone repos, validate `Dockerfile`, extract tags (`tags.yaml`, README heuristics), enqueue builds.
3. **Build & Runtime Orchestration** – Use a worker queue (BullMQ/Celery) with BuildKit, publish containers to an internal registry, and surface preview URLs.
4. **Enhanced Search** – Index descriptions/tags in Postgres or dedicated search (Meilisearch/OpenSearch) for fuzzy matches & ranking.
5. **User Features** – Profiles with customizable key bindings, saved collections, launch history.

## Open Questions

- Preferred identity+auth model (GitHub OAuth vs. platform-native accounts?).
- Resource limits + billing for running apps (timeouts, CPU/memory caps?).
- Multi-tenancy concerns: should every launch run in isolated namespaces (Kubernetes vs. lightweight Firecracker VMs)?
- Tag curation: manual only, or automated enrichment via language/framework detection?
- Governance for community submissions (moderation, abuse prevention, licensing checks?).
