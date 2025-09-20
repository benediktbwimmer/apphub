# Next Steps Roadmap

This guide captures prioritized ideas for maturing Osiris AppHub. Each item calls out the primary owner, suggested deliverables, and recommended validation so new contributors can jump in quickly.

## High-Priority Implementation Ideas

1. **Promote SQLite prototypes to a relational migration path**
   - **Goal**: Introduce a migration layer (e.g., Kysely or Knex) that prepares the catalog service for PostgreSQL.
   - **Scope**: Define migration scripts for repositories, tags, ingestion events, and build tables using the schema in `docs/architecture.md`.
   - **Validation**: Run migrations against SQLite during CI and confirm the API can still register, ingest, and query demo repositories.

2. **Build artifact storage integration**
   - **Goal**: Preserve build logs and produced image references outside the runtime filesystem.
   - **Scope**: Add an abstraction for pushing logs to object storage (S3-compatible) and storing image metadata in the catalog database.
   - **Validation**: Add unit tests that exercise the abstraction against a mocked storage layer and e2e coverage that verifies artifact URLs appear in the repository history endpoint.

3. **Preview session launch flow**
   - **Goal**: Connect the catalog API to a runner that can start ephemeral containers.
   - **Scope**: Implement `POST /launches` in the API, enqueue launch jobs, and create a stub runner that returns signed preview URLs.
   - **Validation**: Extend e2e tests to simulate a launch request and assert the job lifecycle updates repository state and emits WebSocket events.

## Quality & Observability Enhancements

- **Structured logging**: Adopt a logger (Pino) with request/trace IDs and persist ingestion/build logs for easier debugging. Verify log fields in integration tests.
- **Service health dashboards**: Extend the service registry tables to capture uptime percentages and expose them through a new `/services/metrics` endpoint. Add API contract tests.
- **Ingestion heuristics**: Expand metadata extraction beyond `package.json` and `tags.yaml` by incorporating README parsing. Add fixtures to cover popular frameworks.

## Testing Backlog

- **Frontend contract tests**: Snapshot the search results UI for seeded repositories and confirm keyboard interactions (Tab, arrow navigation) via Playwright.
- **API regression suite**: Convert the current ingestion e2e flow into modular scenarios that also cover failure cases (e.g., missing Dockerfile, repeated retries).
- **Background worker isolation**: Provide unit tests for queue handlers using fakes for Redis and Git to ensure the retry logic is deterministic.

## Developer Experience

- **Local orchestration scripts**: Add npm scripts for seeding demo data and resetting Redis/SQLite state to simplify onboarding.
- **Documentation refresh**: Keep `README.md` and `docs/architecture.md` synchronized with new endpoints, environment variables, and operational runbooks.
- **Contribution templates**: Create issue and PR templates outlining the checks to run and expected artifact links (logs, screenshots).

## How to Use This Roadmap

Pick one item, create an issue referencing this document, and sketch an implementation plan before opening a PR. Update this file as items ship or priorities shift so the roadmap stays actionable.
