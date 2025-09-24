# Osiris AppHub

"YouTube of web applications" prototype that catalogs container-ready repositories, surfaces searchable metadata, and offers a keyboard-first tag experience.

## Project Layout

```
apphub/
├── docs/
│   └── architecture.md       # High-level system design + roadmap ideas
│   └── assets-overview.md    # Auto-materialization events, policies, and worker setup
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

Metadata persists in PostgreSQL. By default the API connects to `postgres://apphub:apphub@127.0.0.1:5432/apphub`; set `DATABASE_URL` if you run Postgres elsewhere. Create the database before starting the service (for example, `createdb apphub && psql -d apphub -c "CREATE ROLE apphub WITH LOGIN PASSWORD 'apphub'; GRANT ALL PRIVILEGES ON DATABASE apphub TO apphub;"`).

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

### Workflow Orchestrator

AppHub's workflow engine coordinates long-running back-end flows such as repository ingest/build pipelines. The orchestrator now
supports dynamic fan-out steps that expand a single logical node into **N** child jobs at runtime and fan the results back in for
downstream processing.

Spin up the workflow coordinator alongside the API and workers:

```bash
cd services/catalog
npm run workflows
```

Runtime configuration highlights:

- `WORKFLOW_MAX_PARALLEL` — global concurrency limit for simultaneously running workflow steps (defaults to the number of defined steps).
- `WORKFLOW_FANOUT_MAX_ITEMS` — safety limit for the number of items a fan-out step may emit (default `100`).
- `WORKFLOW_FANOUT_MAX_CONCURRENCY` — cap on the number of fan-out children the orchestrator will execute in parallel (default `10`).

Fan-out step definitions live alongside traditional `job` and `service` steps. A fan-out step supplies a collection expression
(`collection`), a template step (`template`) that defines the child job/service payload, and optional guardrails such as
`maxItems`, `maxConcurrency`, and `storeResultsAs` for aggregating child outputs into the shared workflow context. The REST API and
`workflow.run.*` events expose the generated child step metadata so the frontend can render progress for each dynamic branch.


### Asset Materializer

Event-driven asset reconciliation runs in a dedicated worker that listens for
`asset.produced` and `asset.expired` events. It automatically enqueues workflow
runs when upstream assets change or freshness windows lapse, and marks those
runs with `trigger.type = 'auto-materialize'` for auditing. The worker can run
inline (Redis `inline` mode) or via BullMQ with delayed expiry jobs.

```bash
cd services/catalog
npm run materializer
```

Key environment variables:
- `ASSET_EVENT_QUEUE_NAME` – BullMQ queue for delayed expiry (`apphub_asset_event_queue` by default).
- `ASSET_MATERIALIZER_BASE_BACKOFF_MS` / `ASSET_MATERIALIZER_MAX_BACKOFF_MS` – failure backoff window (defaults `120000` / `1800000`).
- `ASSET_MATERIALIZER_REFRESH_INTERVAL_MS` – graph refresh cadence (default `600000`).

See `docs/assets-overview.md` for auto-materialization policies and event flow details.

### File Drop Watcher Demo

A new sample service (`services/examples/file-drop-watcher`) demonstrates how external automations can trigger workflows. It watches
`services/catalog/data/examples/file-drop/inbox` for new files, launches the `file-drop-relocation` workflow, and updates a simple dashboard once files land in the archive directory. Import the relocator job and workflow via the "File drop watcher demo" example scenario, then drop files into the inbox to replay the flow locally.

See `docs/file-drop-watcher.md` for setup instructions and a deeper walk-through.

### Frontend

```bash
cd apps/frontend
npm install
cp .env.example .env.local    # Update if the API runs elsewhere
npm run dev
```

The Vite dev server binds to `http://localhost:5173`.

### Docker Images

Build the combined API + worker + frontend image:

```bash
docker build -t apphub:latest .
```

#### Local development

Run everything (API, workers, Redis, Postgres, static frontend) inside the container with transient data:

```bash
docker run --rm -it \
  --name apphub-dev \
  -p 4000:4000 \
  -p 4173:4173 \
  -e APPHUB_SESSION_SECRET=dev-session-secret-change-me \
  -e APPHUB_AUTH_SSO_ENABLED=false \
  -e APPHUB_LEGACY_OPERATOR_TOKENS=true \
  -e APPHUB_OPERATOR_TOKENS='[{"token":"dev-token","subject":"local-operator","scopes":"*"}]' \
  apphub:latest
```

You can now hit `http://localhost:4000` (API) and `http://localhost:4173` (frontend). Use the bearer token `dev-token` for manual API calls while testing.

Persist Postgres/Redis state by adding `-v apphub-data:/app/data` to the command above.

#### Production

Launch the same image with hardened auth settings, external Postgres/Redis, and SSO enabled:

```bash
docker run -d \
  --name apphub \
  --restart unless-stopped \
  -p 0.0.0.0:4000:4000 \
  -p 0.0.0.0:4173:4173 \
  -v apphub-data:/app/data \
  -e APPHUB_SESSION_SECRET=$(openssl rand -hex 32) \
  -e APPHUB_SESSION_COOKIE_SECURE=true \
  -e APPHUB_AUTH_SSO_ENABLED=true \
  -e APPHUB_OIDC_ISSUER=https://accounts.google.com \
  -e APPHUB_OIDC_CLIENT_ID=your-oauth-client-id \
  -e APPHUB_OIDC_CLIENT_SECRET=your-oauth-client-secret \
  -e APPHUB_OIDC_REDIRECT_URI=https://your-domain.example/auth/callback \
  -e APPHUB_OIDC_ALLOWED_DOMAINS=example.com \
  -e DATABASE_URL=postgres://apphub:secret@db-host:5432/apphub \
  -e REDIS_URL=redis://redis-host:6379 \
  apphub:latest
```

Terminate legacy operator tokens (`APPHUB_LEGACY_OPERATOR_TOKENS=false`) once every automation client has migrated to user-issued API keys. Frontend traffic typically flows through a TLS-terminating reverse proxy that maps the public hostname to ports `4173` (static UI) and `4000` (API/websocket).

### Environment Variables

`apps/frontend/.env.example`
```bash
VITE_API_BASE_URL=http://localhost:4000
VITE_LAUNCH_INTERNAL_PORT=3000
```

Update as needed for different deployment targets.

`services/catalog` reads the following environment variables (defaults shown where applicable):

**Core service & database**

```bash
PORT=4000                              # API port
HOST=::                                # Bind address (set 0.0.0.0 when containerised)
DATABASE_URL=postgres://apphub:apphub@127.0.0.1:5432/apphub
PGPOOL_MAX=20
PGPOOL_IDLE_TIMEOUT_MS=30000
PGPOOL_CONNECTION_TIMEOUT_MS=10000
SERVICE_CONFIG_PATH=services/service-config.json
SERVICE_MANIFEST_PATH=services/service-manifest.json
SERVICE_REGISTRY_TOKEN=
SERVICE_CLIENT_TIMEOUT_MS=60000
SERVICE_HEALTH_INTERVAL_MS=30000
SERVICE_HEALTH_TIMEOUT_MS=5000
SERVICE_OPENAPI_REFRESH_INTERVAL_MS=900000
APPHUB_HOST_ROOT=                      # Optional host root used to resolve launch START_PATH mounts (legacy alias HOST_ROOT_PATH)
```

`SERVICE_CONFIG_PATH` and `SERVICE_MANIFEST_PATH` accept comma-separated lists if you need to merge multiple manifests.

**Redis, queues & events**

```bash
REDIS_URL=redis://127.0.0.1:6379         # Set to "inline" to execute queues without Redis
APPHUB_EVENTS_MODE=                    # "inline" to bypass Redis publish/subscribe
APPHUB_EVENTS_CHANNEL=apphub:events
INGEST_QUEUE_NAME=apphub_queue
BUILD_QUEUE_NAME=apphub_build_queue
LAUNCH_QUEUE_NAME=apphub_launch_queue
WORKFLOW_QUEUE_NAME=apphub_workflow_queue
```

**Repository ingestion**

```bash
INGEST_CONCURRENCY=2
INGEST_JOB_ATTEMPTS=3
INGEST_JOB_BACKOFF_MS=10000
INGEST_CLONE_DEPTH=1
INGEST_MAX_INLINE_PREVIEW_BYTES=1500000
```

**Build pipeline**

```bash
BUILD_CONCURRENCY=1
BUILD_CLONE_DEPTH=1
```

**Launch runner & preview**

```bash
LAUNCH_CONCURRENCY=1
LAUNCH_RUNNER_MODE=docker              # Use "stub" to bypass Docker during local development
LAUNCH_INTERNAL_PORT=                  # Override detected container port
LAUNCH_PREVIEW_BASE_URL=http://127.0.0.1
LAUNCH_PREVIEW_PORT=443
LAUNCH_PREVIEW_TOKEN_SECRET=preview-secret
SERVICE_NETWORK_BUILD_TIMEOUT_MS=600000
SERVICE_NETWORK_BUILD_POLL_INTERVAL_MS=2000
SERVICE_NETWORK_LAUNCH_TIMEOUT_MS=300000
SERVICE_NETWORK_LAUNCH_POLL_INTERVAL_MS=2000
```

**Authentication & sessions**

```bash
APPHUB_SESSION_SECRET=                   # Required: random string used to sign session cookies
APPHUB_SESSION_COOKIE=apphub_session     # Override the session cookie name
APPHUB_LOGIN_STATE_COOKIE=apphub_login_state
APPHUB_SESSION_TTL_SECONDS=43200         # Session lifetime (default 12h)
APPHUB_SESSION_RENEW_SECONDS=1800        # Renew window when active (default 30m)
APPHUB_SESSION_COOKIE_SECURE=true        # Secure cookies only over HTTPS
APPHUB_AUTH_SSO_ENABLED=false            # Enable OAuth2/OIDC login when true
APPHUB_OIDC_ISSUER=                      # OIDC issuer URL (required when SSO enabled)
APPHUB_OIDC_CLIENT_ID=
APPHUB_OIDC_CLIENT_SECRET=
APPHUB_OIDC_REDIRECT_URI=https://your-domain.example/auth/callback
APPHUB_OIDC_ALLOWED_DOMAINS=example.com,internal.example
APPHUB_AUTH_API_KEY_SCOPE=auth:manage-api-keys
APPHUB_LEGACY_OPERATOR_TOKENS=true       # Allow bearer tokens during migration
APPHUB_OPERATOR_TOKENS=                  # Optional JSON array of legacy tokens
APPHUB_OPERATOR_TOKENS_PATH=             # Path to JSON file with legacy tokens
```

**Workflow orchestration**

```bash
WORKFLOW_CONCURRENCY=1
WORKFLOW_MAX_PARALLEL=                  # Overrides per-workflow parallel limit
WORKFLOW_FANOUT_MAX_ITEMS=100
WORKFLOW_FANOUT_MAX_CONCURRENCY=10
WORKFLOW_FAILURE_ALERT_THRESHOLD=3
WORKFLOW_FAILURE_ALERT_WINDOW_MINUTES=15
WORKFLOW_ALERT_WEBHOOK_URL=
WORKFLOW_ALERT_WEBHOOK_TOKEN=
```

**Tokens, secrets & access control**

```bash
APPHUB_OPERATOR_TOKENS=
APPHUB_OPERATOR_TOKENS_PATH=
APPHUB_SECRET_STORE=
APPHUB_SECRET_STORE_PATH=
```

**Job bundle registry & storage**

```bash
APPHUB_JOB_BUNDLES_ENABLED=
APPHUB_JOB_BUNDLES_ENABLE_SLUGS=
APPHUB_JOB_BUNDLES_DISABLE_SLUGS=
APPHUB_JOB_BUNDLES_DISABLE_FALLBACK=
APPHUB_JOB_BUNDLES_DISABLE_FALLBACK_SLUGS=
APPHUB_JOB_BUNDLE_MAX_SIZE=16777216
APPHUB_JOB_BUNDLE_DOWNLOAD_TTL_MS=300000
APPHUB_JOB_BUNDLE_STORAGE_BACKEND=local
APPHUB_JOB_BUNDLE_STORAGE_DIR=services/catalog/data/job-bundles
APPHUB_JOB_BUNDLE_SIGNING_SECRET=
APPHUB_JOB_BUNDLE_CACHE_MAX_ENTRIES=16
APPHUB_JOB_BUNDLE_CACHE_TTL_MS=900000
APPHUB_JOB_BUNDLE_S3_BUCKET=
APPHUB_JOB_BUNDLE_S3_REGION=us-east-1   # Falls back to AWS_REGION when set
APPHUB_JOB_BUNDLE_S3_ENDPOINT=
APPHUB_JOB_BUNDLE_S3_FORCE_PATH_STYLE=false
APPHUB_JOB_BUNDLE_S3_PREFIX=
APPHUB_JOB_BUNDLE_SANDBOX_MAX_LOGS=200
```

**Logging & observability**

```bash
APPHUB_LOG_SOURCE=catalog-service
APPHUB_LOG_AGGREGATOR_URL=
APPHUB_LOG_AGGREGATOR_TOKEN=
```

**AI builder & automation**

```bash
APPHUB_CODEX_PROXY_URL=http://host.docker.internal:3030
APPHUB_CODEX_PROXY_TOKEN=
APPHUB_CODEX_MOCK_DIR=
APPHUB_AI_BUNDLE_SLUG=
APPHUB_AI_BUNDLE_VERSION=
```

**Testing & diagnostics**

```bash
APPHUB_E2E_DEBUG_TEMPLATES=
```

### Running Codex through the proxy

The AI builder now invokes Codex via the host-side proxy service under `services/codex-proxy`. This avoids bind-mounting the macOS
binary into Linux containers and works for both `npm run dev` and the Docker image.

1. From the repository root: `cd services/codex-proxy && python3 -m venv .venv && source .venv/bin/activate`.
2. Install the package: `pip install .`.
3. Point the proxy at your host Codex binary (for example, `export CODEX_PROXY_CLI=/opt/homebrew/bin/codex`).
4. Optionally require a shared secret: `export CODEX_PROXY_TOKEN="change-me"`.
5. Launch the service: `codex-proxy` (defaults to `127.0.0.1:3030`).

When the catalog API runs inside Docker, set `APPHUB_CODEX_PROXY_URL=http://host.docker.internal:3030` so it can reach the host.
For processes running on the host directly, the default `http://127.0.0.1:3030` also works. Additional guidance lives in
`docs/ai-builder.md`.
- The proxy exposes `/v1/codex/jobs` for long-running generations; the API polls this endpoint to stream stdout/stderr into the AI builder UI.

Operator tokens are defined as JSON objects with a `subject`, `token`, and optional `scopes`. Tokens default to full access when
no scopes are provided. A starter template lives at `services/catalog/config/operatorTokens.example.json`.

```bash
APPHUB_OPERATOR_TOKENS='[{"subject":"platform-ops","token":"dev-ops-token","scopes":["jobs:write","jobs:run","workflows:write","workflows:run"]}]'
```

Secrets referenced by workflow and job steps resolve through the secret store. Provide entries inline with
`APPHUB_SECRET_STORE` or via `APPHUB_SECRET_STORE_PATH`. See `services/catalog/config/secretStore.example.json` for a sample layout:

```bash
APPHUB_SECRET_STORE='{"TEST_SERVICE_TOKEN":{"value":"workflow-secret-token","version":"v1"}}'
```

Every secret resolution is captured in the audit log with the requesting actor, workflow run, and step metadata.

### Metrics & Observability

- Structured JSON logs are emitted with the `source` identifier (default `catalog-service`) and forwarded to
  `APPHUB_LOG_AGGREGATOR_URL` when configured.
- `GET /metrics` exposes aggregated job and workflow run counts, average durations, and failure rates for dashboards.
- Configure `WORKFLOW_FAILURE_ALERT_THRESHOLD`, `WORKFLOW_FAILURE_ALERT_WINDOW_MINUTES`, and (optionally)
  `WORKFLOW_ALERT_WEBHOOK_URL` to receive notifications when workflows fail repeatedly within the sliding window.
- Alert payloads and structured warnings include workflow identifiers, failure counts, and triggering metadata to support rapid triage.

### Service Configuration

The service registry consumes `services/service-config.json`, a declarative module file inspired by Go's dependency management system.
It can point at the bundled `service-manifest.json`, inline service definitions, and declare `imports` that pull additional
service manifests from Git repositories. Each import records the remote repository, an optional tag/branch `ref`, and an optional
`commit` SHA. The registry clones every module, walks the dependency DAG, and merges the resulting service entries with any extra
JSON manifests referenced via `SERVICE_MANIFEST_PATH` when you explicitly trigger a refresh.

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

The response includes the module identifier, resolved commit SHA, and number of discovered services. The catalog no longer
ingests manifests automatically on boot—invoke one of the import endpoints (or call the `refreshManifest` helper in code)
whenever you want to sync declarative definitions into the registry.

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

Ensure a PostgreSQL instance is reachable at the connection string in `DATABASE_URL` before launching the dev stack; the script does not start Postgres automatically.

Stop the stack with `Ctrl+C`.

### Docker Image

A single container image bundles PostgreSQL, Redis, the catalog API, background workers, and the static frontend. Update
`services/catalog/config/operator-tokens.json` and (optionally) copy `services/catalog/config/secretStore.example.json` to
`services/catalog/config/secret-store.json` before launching so the container can mount your tokens and secrets read-only:

```bash
docker build -t apphub .
docker run \
  --rm \
  --name apphub \
  -p 4000:4000 \
  -p 4173:4173 \
  -p 6379:6379 \
  -v apphub-data:/app/data \
  -v "$(pwd)/services/catalog/config:/app/config:ro" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /:/root-fs:ro \
  -e APPHUB_HOST_ROOT=/root-fs \
  -e APPHUB_OPERATOR_TOKENS_PATH=/app/config/operator-tokens.json \
  -e APPHUB_SECRET_STORE_PATH=/app/config/secret-store.json \
  -e APPHUB_CODEX_PROXY_URL=http://host.docker.internal:3030 \
  apphub
```

Notes:
- The container exposes Redis on port `6379`; external services should point `REDIS_URL` at `redis://<host>:6379` (use `host.docker.internal` on macOS).
- Build and launch workers shell out to Docker, so the container needs the host Docker socket mounted at `/var/run/docker.sock`. If you prefer not to expose Docker, set `LAUNCH_RUNNER_MODE=stub` and omit the socket/host mounts.
- Mount the host filesystem (or specific directories your workloads need) into the container and set `APPHUB_HOST_ROOT` so the launch worker can validate `START_PATH` values. The example above binds `/` read-only to `/root-fs`; you can narrow scope with mounts like `-v /Users:/root-fs/Users:ro`.
- Start `services/codex-proxy` on the host before launching the container so the AI builder can reach Codex via `APPHUB_CODEX_PROXY_URL`.
- `apphub-data` persists PostgreSQL (`/app/data/postgres`) and local job-bundle artifacts (`/app/data/job-bundles`). Remove the volume for a clean slate.
- The compiled frontend is served from http://localhost:4173 and the API remains at http://localhost:4000. External service manifests are **not** bundled—load them dynamically through the API at runtime.
- Python 3.11 (via `python3`, `python`, and `pip3`) ships in the runtime image for bundle authors that need Python tooling. Install dependencies inside a per-run virtual environment or vendor wheels alongside the bundle rather than modifying global site packages.

Stop the container with `Ctrl+C` or `docker stop` when running detached.

### Publishing the Runtime Image

Use the helper script to rebuild and publish the multi-service runtime image after making Dockerfile changes:

```bash
APPHUB_RUNTIME_IMAGE=ghcr.io/apphub/runtime \
APPHUB_RUNTIME_LATEST_TAG=latest \
./scripts/publish-runtime.sh
```

The script tags the image with the current Git SHA by default and optionally applies an alias (such as `latest`). Set `APPHUB_RUNTIME_PUSH=0` to skip pushing when testing locally.

## Testing

End-to-end suite spins up the catalog API, BullMQ worker (using an in-memory Redis mock), and a temporary Git repository to verify the full ingestion loop:

```bash
cd services/catalog
npm run test:e2e
```

The script launches an embedded PostgreSQL instance, registers a sample repo, waits for ingestion to finish, and asserts that history events capture status transitions, attempt counts, commit SHA, and duration.

### Job Bundle CLI

Developer tooling for dynamic job bundles lives in `apps/cli`. Install dependencies with `npm install --prefix apps/cli`, then use the `apphub` binary to scaffold, test, and publish bundles:

```bash
npx tsx apps/cli/src/index.ts jobs package ./examples/summary-job
npx tsx apps/cli/src/index.ts jobs test ./examples/summary-job --input-json '{"foo":"bar"}'
npx tsx apps/cli/src/index.ts jobs publish ./examples/summary-job --token dev-operator-token
```

The CLI creates `apphub.bundle.json`, validates `manifest.json` against the registry schema, emits reproducible tarballs with SHA-256 signatures, and wires a local harness for executing handlers with sample payloads. See `docs/job-bundles.md` for a complete walkthrough. The example importer no longer relies on prebuilt archives—when you load an example bundle, the catalog API packages the sources on demand and streams the result directly into the registry. The first run may take longer while dependencies are installed inside each bundle directory; subsequent imports reuse the compiled output.

## Current Functionality

- Optional seeded catalog of sample web apps with tags like `framework:nextjs`, `category:media`, `runtime:node18`. A
  Postgres-compatible seed script is planned; the legacy SQLite fixture at
  `services/catalog/tests/fixtures/seeded-catalog.sql` remains for reference only. The application now starts with an empty catalog by default.
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
