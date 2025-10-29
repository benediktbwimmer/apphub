# Osiris AppHub

"YouTube of web applications" prototype whose core service indexes container-ready repositories, surfaces searchable metadata, and offers a keyboard-first tag experience.

## Project Layout

```
apphub/
├── docs/
│   ├── architecture.md       # High-level system design + roadmap ideas
│   └── assets-overview.md    # Auto-materialization events, policies, and worker setup
├── modules/
│   └── observatory/                 # Reference module that ships the observatory jobs, services, and workflows
├── packages/
│   ├── shared/               # Shared types + registries consumed by multiple services
│   ├── module-registry/      # Catalog + loader utilities for module metadata
│   └── modules/              # Module bundles and resources
├── services/
│   ├── core/              # Fastify API + background workers
│   └── metastore/            # Flexible metadata storage + search service
└── apps/
    ├── cli/                  # Workspace-aware job bundle tooling
    └── frontend/             # Vite + React search UI with tag-driven autocomplete
```

## Getting Started

### Quick Start

AppHub provides two development modes:

**Local Development (Recommended for development)**
```bash
npm install
npm run local-dev
```

**Docker-based Development (Uses containers for dependencies)**
```bash
npm install
npm run docker-dev
```

The local runner uses native PostgreSQL and Redis installations when available, or falls back to embedded instances. The docker runner provisions PostgreSQL and MinIO containers, launches Redis, and starts the core services plus the frontend.

Both runners start the core services plus the frontend. Modules are no longer published automatically; load the Environmental Observatory bundle after the stack settles:

```bash
npm run dev:observatory
```

Maintenance helpers:

- `npm run dev:clear:postgres` — stop and remove the dev PostgreSQL container plus its volume so the next run reinitializes a clean database.
- `npm run dev:clear:redis` — flush every key from the local Redis instance used by workers.
- `npm run dev:clear:minio` — stop the MinIO container and drop its volume to wipe all buckets.
- `npm run dev:clear:all` — run the Redis flush and reset both storage containers in one step.

### Install Dependencies

```bash
npm install
```

All packages are managed through npm workspaces, so a single install at the repo root prepares every app, service, and shared module.

### Regenerate OpenAPI Clients

Typed API clients for core services are generated from their OpenAPI documents. Regenerate the shared clients whenever a service spec changes:

```bash
npm run generate:openapi-clients
```

CI (and `npm run lint`) will invoke `npm run check:openapi-clients` to ensure the generated artifacts match the committed output.

### Run Tests

```bash
npm test
```

Executes every workspace's `test` script sequentially, ensuring unit, integration, and end-to-end suites stay green together.

### One-command Minikube stack

Provision the full AppHub stack on minikube (build images, load them, deploy manifests) with:

```bash
npm run minikube:up
```

When you're done, tear it back down:

```bash
npm run minikube:down
```

Prerequisites: Docker, minikube, kubectl, and enough local resources (recommended: 4 CPUs, 8 GiB RAM). See `infra/minikube/README.md` for detailed ingress and troubleshooting notes.

### Core API

```bash
npm run dev --workspace @apphub/core
```

The API listens on `http://localhost:4000` by default and serves:
- `GET /apps` & `GET /apps/:id` for metadata search
- `GET /tags/suggest` for `key:value` autocomplete
- `POST /apps` for registering new repositories (creates a pending ingest job)
- `POST /apps/:id/retry` to manually requeue ingestion for an existing repository
- `GET /apps/:id/history` to inspect recent ingestion events and attempt counts
- `GET /services` to inspect dynamically registered auxiliary services and their health status

Metadata persists in PostgreSQL. By default the API connects to `postgres://apphub:apphub@127.0.0.1:5432/apphub`; set `DATABASE_URL` if you run Postgres elsewhere. Create the database before starting the service (for example, `createdb apphub && psql -d apphub -c "CREATE ROLE apphub WITH LOGIN PASSWORD 'apphub'; GRANT ALL PRIVILEGES ON DATABASE apphub TO apphub;"`).

#### Job Bundle Storage

Job bundle packaging stores status records in PostgreSQL and pushes bundle archives to an S3-compatible object store. Set the `APPHUB_BUNDLE_STORAGE_*` variables before starting the core service. For local smoke tests you can keep `APPHUB_BUNDLE_STORAGE_BACKEND=local`, but multi-replica setups (including minikube) should point to MinIO or AWS S3. See [`docs/job-bundle-storage.md`](docs/job-bundle-storage.md) for a configuration walkthrough and migration instructions.

### Metastore Service

```bash
npm run dev --workspace @apphub/metastore
```

The metastore reuses the same PostgreSQL instance and exposes a dedicated REST API for storing arbitrary JSON metadata keyed by `namespace` + `key`. Endpoints cover CRUD, optimistic locking, rich search (`eq/neq`, range, containment, boolean composition), and bulk operations. Authentication honours the shared bearer token configuration (`APPHUB_METASTORE_TOKENS` or `APPHUB_OPERATOR_TOKENS`) with namespace-scoped RBAC, and `APPHUB_AUTH_DISABLED=1` bypasses auth in local development. Metrics are available at `/metrics` (Prometheus format) and standard health probes at `/healthz` / `/readyz`. See `docs/metastore.md` for payload shapes and filter DSL reference.

### Ingestion Worker

Repository submissions land in a `pending` state until the ingestion worker clones the repo, verifies the `Dockerfile`, and enriches tags from project metadata.

Use `POST /apps/:id/retry` to manually requeue a failed repository; the UI offers a shortcut button once a repo is marked `failed`.

`GET /apps/:id/history` returns the latest ingestion events including status, message, attempt number, commit SHA (when available), and duration in milliseconds for deeper debugging.

```bash
npm run ingest --workspace @apphub/core
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
npm run workflows --workspace @apphub/core
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
npm run materializer --workspace @apphub/core
```

Key environment variables:
- `ASSET_EVENT_QUEUE_NAME` – BullMQ queue for delayed expiry (`apphub_asset_event_queue` by default).
- `ASSET_MATERIALIZER_BASE_BACKOFF_MS` / `ASSET_MATERIALIZER_MAX_BACKOFF_MS` – failure backoff window (defaults `120000` / `1800000`).
- `ASSET_MATERIALIZER_REFRESH_INTERVAL_MS` – graph refresh cadence (default `600000`).

See `docs/assets-overview.md` for auto-materialization policies and event flow details.

### Environmental Observatory Module

The bundled observatory scenario now lives under `modules/observatory/`. Building the module publishes job bundles, workflows, and service registrations to the local catalog so the importer can hydrate everything through `/modules/catalog`.

Use the "Environmental observatory" entry in the Import wizard to pull the curated service manifest, jobs, and workflows. The wizard now sources data directly from the module catalog and resolves dependencies (jobs, workflows, and provisioning triggers) using the module loader introduced in Ticket 006.

The end-to-end walkthrough lives in `docs/environmental-observatory-workflows.md` and covers bootstrap scripts, trigger wiring, and validation steps once synthetic minute-level data begins to flow.

### Frontend

```bash
cp apps/frontend/.env.example apps/frontend/.env.local    # Update if the API runs elsewhere
npm run dev --workspace @apphub/frontend
```

The Vite dev server binds to `http://localhost:5173`.

Override `VITE_FILESTORE_BASE_URL` in `.env.local` when the filestore service runs on a distinct origin from the core proxy.

### Kubernetes runtime (recommended)

Use the Kubernetes declarative stack for both local testing and staging. The turnkey workflow builds images, loads them into minikube, applies manifests, and waits for pods to settle:

```bash
npm run minikube:up
```

Validate the deployment whenever you refresh the cluster:

```bash
npm run minikube:verify
```

Tear everything down once you are finished:

```bash
npm run minikube:down
```

See `infra/minikube/README.md` and `docs/runbooks/minikube-bootstrap.md` for ingress setup, troubleshooting, and production alignment guidelines.

### Legacy Docker image (deprecated)

The monolithic Docker workflow now exists solely for air-gapped demos and should not be used for day-to-day development.

Build the combined API + worker + frontend image when necessary:

```bash
docker build -t apphub:latest .
```

Run the container with elevated privileges and persistent volumes if you still rely on this path:

```bash
docker run --rm -it \
  --name apphub-dev \
  --privileged \
  -p 4000:4000 \
  -p 4100:4100 \
  -p 4200:4200 \
  -p 4173:4173 \
  -p 6379:6379 \
  -v apphub-data:/app/data \
  -v apphub-docker-data:/app/data/docker \
  -e NODE_ENV=development \
  -e APPHUB_AUTH_DISABLED=true \
  -e APPHUB_SESSION_SECRET=legacy-session-secret-change-me \
  -e APPHUB_SESSION_COOKIE_SECURE=false \
  apphub:latest
```

#### Core Kubernetes Runtime

The modular core runtime (`docker/Dockerfile.services` `--target core-runtime`) now bundles Kubernetes tooling for build and launch workers. The image installs `kubectl` 1.29 and `helm` 3.14 and starts via `/app/services/core/scripts/core-runtime-entrypoint.sh`, which:

- Executes `kubectl version --client` through `services/core/dist/scripts/kubernetesSmoke.js` and logs warnings if the binary is missing or credentials are not mounted.
- Sets minikube-friendly defaults when unset: `APPHUB_K8S_BUILDER_SERVICE_ACCOUNT=apphub-builder`, `APPHUB_K8S_LAUNCH_SERVICE_ACCOUNT=apphub-preview`, and `APPHUB_K8S_REGISTRY_ENDPOINT=registry.kube-system.svc.cluster.local:5000`.
- Respects `APPHUB_K8S_DISABLE_DEFAULTS=1` to skip those defaults and `APPHUB_K8S_REQUIRE_TOOLING=1` to fail the container when the smoke check reports an error.

Override the `CMD` at runtime to switch between the API (`node services/core/dist/server.js`), build worker (`node services/core/dist/buildWorker.js`), and launch worker (`node services/core/dist/launchWorker.js`) while keeping the Kubernetes tooling layer and smoke checks consistent.

#### Production

Reuse the same volumes when running in production. Launch the image with hardened auth settings, external Postgres/Redis, and SSO enabled:

```bash
docker run -d \
  --name apphub \
  --privileged \
  --restart unless-stopped \
  -p 0.0.0.0:4000:4000 \
  -p 0.0.0.0:4100:4100 \
  -p 0.0.0.0:4200:4200 \
  -p 0.0.0.0:4173:4173 \
  -v apphub-data:/app/data \
  -v apphub-docker-data:/app/data/docker \
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

`services/core` reads the following environment variables (defaults shown where applicable):

**Core service & database**

```bash
PORT=4000                              # API port
HOST=::                                # Bind address (set 0.0.0.0 when containerised)
DATABASE_URL=postgres://apphub:apphub@127.0.0.1:5432/apphub
PGPOOL_MAX=5
PGPOOL_IDLE_TIMEOUT_MS=30000
PGPOOL_CONNECTION_TIMEOUT_MS=10000
SERVICE_REGISTRY_TOKEN=
SERVICE_CLIENT_TIMEOUT_MS=60000
SERVICE_HEALTH_INTERVAL_MS=30000
SERVICE_HEALTH_TIMEOUT_MS=5000
SERVICE_OPENAPI_REFRESH_INTERVAL_MS=900000
```


**Redis, queues & events**

```bash
APPHUB_ALLOW_INLINE_MODE=false           # Set true only for single-process smoke tests
REDIS_URL=redis://127.0.0.1:6379         # Use "inline" together with APPHUB_ALLOW_INLINE_MODE=true for test-only inline execution
APPHUB_EVENTS_MODE=                    # "inline" (requires APPHUB_ALLOW_INLINE_MODE=true) to bypass Redis publish/subscribe
APPHUB_EVENTS_CHANNEL=apphub:events
APPHUB_EVENT_PROXY_URL=                # Optional HTTP endpoint for publishing events without BullMQ
APPHUB_EVENT_PROXY_TOKEN=              # Bearer token used by sandboxed bundles when calling the proxy
APPHUB_EVENT_PROXY_TOKENS=             # Comma-separated list of accepted proxy tokens on the core service
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
APPHUB_BUILD_EXECUTION_MODE=kubernetes   # Use "docker" for legacy local builds or "stub" to bypass execution
APPHUB_K8S_NAMESPACE=apphub             # Target namespace for build and launch resources
APPHUB_K8S_BUILDER_IMAGE=ghcr.io/apphub/builder:latest
```

**Launch runner & preview**

```bash
LAUNCH_CONCURRENCY=1
APPHUB_LAUNCH_EXECUTION_MODE=kubernetes # Set to "docker" for local fallback or "stub" to skip launches
LAUNCH_INTERNAL_PORT=                  # Override detected container port
LAUNCH_PREVIEW_BASE_URL=http://127.0.0.1
LAUNCH_PREVIEW_PORT=443
LAUNCH_PREVIEW_TOKEN_SECRET=preview-secret
SERVICE_NETWORK_BUILD_TIMEOUT_MS=600000
SERVICE_NETWORK_BUILD_POLL_INTERVAL_MS=2000
SERVICE_NETWORK_LAUNCH_TIMEOUT_MS=300000
SERVICE_NETWORK_LAUNCH_POLL_INTERVAL_MS=2000
APPHUB_K8S_PREVIEW_URL_TEMPLATE=        # Optional: e.g. https://{launch}.preview.local for ingress
APPHUB_K8S_LAUNCH_SERVICE_ACCOUNT=      # Service account for preview workloads
APPHUB_K8S_INGRESS_CLASS=               # ingressClassName when provisioning preview URLs
```

See `docs/runbooks/remote-build-launch.md` for Kubernetes setup guidance covering both minikube and multi-tenant clusters.

**Authentication & sessions**

```bash
APPHUB_SESSION_SECRET=                   # Required: random string used to sign session cookies
APPHUB_SESSION_COOKIE=apphub_session     # Override the session cookie name
APPHUB_LOGIN_STATE_COOKIE=apphub_login_state
APPHUB_SESSION_TTL_SECONDS=43200         # Session lifetime (default 12h)
APPHUB_SESSION_RENEW_SECONDS=1800        # Renew window when active (default 30m)
APPHUB_SESSION_COOKIE_SECURE=true        # Secure cookies only over HTTPS
APPHUB_AUTH_DISABLED=false              # Disable all authentication for local development
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
WORKFLOW_CONCURRENCY=50
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
APPHUB_JOB_BUNDLE_STORAGE_DIR=services/core/data/job-bundles
APPHUB_JOB_BUNDLE_SIGNING_SECRET=
APPHUB_JOB_BUNDLE_CACHE_MAX_ENTRIES=16
APPHUB_JOB_BUNDLE_CACHE_TTL_MS=900000
APPHUB_JOB_BUNDLE_S3_BUCKET=
APPHUB_JOB_BUNDLE_S3_REGION=us-east-1   # Falls back to AWS_REGION when set
APPHUB_JOB_BUNDLE_S3_ENDPOINT=
APPHUB_JOB_BUNDLE_S3_FORCE_PATH_STYLE=false
APPHUB_JOB_BUNDLE_S3_ACCESS_KEY_ID=      # Falls back to APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID when unset
APPHUB_JOB_BUNDLE_S3_SECRET_ACCESS_KEY=  # Falls back to APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY when unset
APPHUB_JOB_BUNDLE_S3_SESSION_TOKEN=      # Optional session token
APPHUB_JOB_BUNDLE_S3_PREFIX=
APPHUB_JOB_BUNDLE_SANDBOX_MAX_LOGS=200
```

**Logging & observability**

```bash
APPHUB_LOG_SOURCE=core-service
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

When the core API runs inside Docker, set `APPHUB_CODEX_PROXY_URL=http://host.docker.internal:3030` so it can reach the host.
For processes running on the host directly, the default `http://127.0.0.1:3030` also works. Additional guidance lives in
`docs/ai-builder.md`.
- The proxy exposes `/v1/codex/jobs` for long-running generations; the API polls this endpoint to stream stdout/stderr into the AI builder UI.

Operator tokens are defined as JSON objects with a `subject`, `token`, and optional `scopes`. Tokens default to full access when
no scopes are provided. A starter template lives at `services/core/config/operatorTokens.example.json`.

```bash
APPHUB_OPERATOR_TOKENS='[{"subject":"platform-ops","token":"dev-ops-token","scopes":["jobs:write","jobs:run","workflows:write","workflows:run"]}]'
```

Secrets referenced by workflow and job steps resolve through the managed secrets service
(`services/secrets`). Start it locally with `npm run dev --workspace @apphub/secrets` and configure
core with a bearer token:

```bash
SECRETS_SERVICE_URL=http://127.0.0.1:4010
SECRETS_SERVICE_ADMIN_TOKEN='replace-with-admin-token'
APPHUB_SECRETS_SUBJECT=apphub.core
```

Admin tokens live in `SECRETS_SERVICE_ADMIN_TOKENS` (or the corresponding `*_PATH`) inside the
service and define which secret keys each caller may mint scoped tokens for. Rotations occur
without restarting core—update the backing store, call `POST /v1/secrets/refresh`, and new values
propagate automatically. The service emits `secret.token.*` and `secret.access` events for auditing.

During migrations you can fall back to the legacy inline store by setting `APPHUB_SECRETS_MODE=inline`
and providing `APPHUB_SECRET_STORE` or `APPHUB_SECRET_STORE_PATH` just like earlier releases:

```bash
APPHUB_SECRETS_MODE=inline
APPHUB_SECRET_STORE='{"TEST_SERVICE_TOKEN":{"value":"workflow-secret-token","version":"v1"}}'
```

Every secret resolution is captured in the database audit log with the requesting actor, workflow run,
and step metadata.

### Metrics & Observability

- Structured JSON logs are emitted with the `source` identifier (default `core-service`) and forwarded to
  `APPHUB_LOG_AGGREGATOR_URL` when configured.
- `GET /metrics` exposes aggregated job and workflow run counts, average durations, and failure rates for dashboards.
- Configure `WORKFLOW_FAILURE_ALERT_THRESHOLD`, `WORKFLOW_FAILURE_ALERT_WINDOW_MINUTES`, and (optionally)
  `WORKFLOW_ALERT_WEBHOOK_URL` to receive notifications when workflows fail repeatedly within the sliding window.
- Alert payloads and structured warnings include workflow identifiers, failure counts, and triggering metadata to support rapid triage.

### Service Configuration

The core no longer reads service manifests or configuration modules from disk at startup. Instead, operators import manifests on
command—typically from checked-in module repositories—using the runtime APIs. Each import clones the referenced repository (or opens the
local path you supply), resolves the manifest graph, and applies the resulting services and service networks directly to the
registry and SQLite store. Subsequent imports for the same module replace the previous definitions so you can iterate without
restarts or environment tweaks.

To register a manifest, call `POST /service-networks/import` (or `/service-config/import`, which is kept for backwards
compatibility) with your `SERVICE_REGISTRY_TOKEN`. Provide either a `repo` URL or local `path`, the optional manifest `configPath`,
and any placeholder variables the module requires. The endpoint validates the manifest, surfaces placeholder conflicts, and then
applies the services in-place—no filesystem persistence or `SERVICE_CONFIG_PATH`/`SERVICE_MANIFEST_PATH` variables required.

```bash
curl -X POST http://127.0.0.1:4000/service-config/import \
  -H "Authorization: Bearer $SERVICE_REGISTRY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "repo": "https://github.com/example/service-module.git",
        "ref": "v1.2.0"
      }'
```

The response includes the module identifier, resolved commit SHA, and number of discovered services. The core no longer
ingests manifests automatically on boot—invoke the import endpoints (or use the Import workspace in the UI) whenever you want to
sync declarative definitions into the registry.

### Run Everything Locally

From the repository root you can start all services in a single command using one of two modes:

**Local Development Mode (Recommended)**
```bash
npm install
npm run local-dev
```

This mode uses native local services when available:
- Automatically starts PostgreSQL and Redis if not already running
- Uses local file storage instead of MinIO
- Falls back to embedded PostgreSQL instances if native PostgreSQL is not installed
- Requires `redis-server` binary on your `$PATH` (macOS: `brew install redis`)
- For best performance, install PostgreSQL locally

**Docker Development Mode**
```bash
npm install
npm run docker-dev
```

This mode uses Docker containers for dependencies:
- Provisions PostgreSQL and MinIO containers
- Launches Redis container
- Requires Docker to be installed and running

Both modes launch:
- Core API on `http://127.0.0.1:4000`
- All background workers (ingestion, builds, launches, workflows, etc.)
- Service orchestrator that spawns dev commands from service manifests
- Frontend on `http://localhost:5173`

Stop either stack with `Ctrl+C`.

### Docker Image

A single container image bundles PostgreSQL, Redis, the core API, background workers, and the static frontend. Update
`services/core/config/operator-tokens.json` and (optionally) copy `services/core/config/secretStore.example.json` to
`services/core/config/secret-store.json` before launching so the container can mount your tokens and secrets read-only:

```bash
docker build -t apphub .
docker run \
  --rm \
  --name apphub \
  -p 4000:4000 \
  -p 4173:4173 \
  -p 6379:6379 \
  -v apphub-data:/app/data \
  -v "$(pwd)/services/core/config:/app/config:ro" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e APPHUB_OPERATOR_TOKENS_PATH=/app/config/operator-tokens.json \
  -e APPHUB_SECRET_STORE_PATH=/app/config/secret-store.json \
  -e APPHUB_CODEX_PROXY_URL=http://host.docker.internal:3030 \
  apphub
```

Notes:
- The container exposes Redis on port `6379`; external services should point `REDIS_URL` at `redis://<host>:6379` (use `host.docker.internal` on macOS).
- Build and launch workers submit workloads to Kubernetes when `APPHUB_BUILD_EXECUTION_MODE` / `APPHUB_LAUNCH_EXECUTION_MODE` are `kubernetes` (default). Ensure the container can talk to your cluster (mount a service account, inject kubeconfig, or use the in-cluster configuration). Set the modes to `docker` if you still rely on local Docker; in that case mount `/var/run/docker.sock` plus any required host paths.
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

End-to-end suite spins up the core API, BullMQ worker (using an in-memory Redis mock), and a temporary Git repository to verify the full ingestion loop:

```bash
npm run test:e2e --workspace @apphub/core
```

The script launches an embedded PostgreSQL instance, registers a sample repo, waits for ingestion to finish, and asserts that history events capture status transitions, attempt counts, commit SHA, and duration.

### Job Bundle CLI

Developer tooling for dynamic job bundles lives in `apps/cli`. The workspace is wired into the root install, so once `npm install` completes you can use the `apphub` binary to scaffold, test, and publish bundles:

```bash
npx tsx apps/cli/src/index.ts jobs package ./modules/observatory/dist/bundles/observatory-data-generator
npx tsx apps/cli/src/index.ts jobs test ./modules/observatory/dist/bundles/observatory-data-generator --input-json '{"minute":"2025-08-01T09:00"}'
npx tsx apps/cli/src/index.ts jobs publish ./modules/observatory/dist/bundles/observatory-data-generator --token dev-operator-token
```

The CLI creates `apphub.bundle.json`, validates `manifest.json` against the registry schema, emits reproducible tarballs with SHA-256 signatures, and wires a local harness for executing handlers with sample payloads. See `docs/job-bundles.md` for a complete walkthrough. Job imports package bundles on demand—when you upload a bundle, the core API stores the results in shared storage and updates the registry immediately. The first run may take longer while dependencies are installed inside each bundle directory; subsequent imports reuse the compiled output.

## Current Functionality

- Optional seeded core of sample web apps with tags like `framework:nextjs`, `category:media`, `runtime:node18`. A
  Postgres-compatible seed script is planned; the legacy SQLite fixture at
  `services/core/tests/fixtures/seeded-core.sql` remains for reference only. The application now starts with an empty core by default.
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
