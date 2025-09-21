# Jobs & Workflows Integration Specification

## Overview
This document explores what is required to extend the AppHub platform with two new orchestration concepts:

- **Jobs** – deterministic operations that run to completion without long-lived state. Existing ingestion and build runners are early examples.
- **Workflows** – composed graphs of services and jobs that collaborate to produce higher-level outcomes (e.g., ingest + build + notify).

The goal is to support declarative registration, execution, tracking, and introspection of both concepts while fitting into the existing Fastify API, BullMQ-powered workers, and service registry.

## Objectives
1. **Unify orchestration vocabulary** so that ingestion, build, and future automation steps share a consistent lifecycle model.
2. **Expose workflow composition** that links jobs and registered services into reproducible pipelines.
3. **Provide operational visibility** through API endpoints and events that mirror current ingestion/build telemetry.
4. **Remain backward compatible** with existing API consumers and workers.

## Core Concepts
### Job Definition
- **Schema**: `id`, `slug`, `name`, `version`, `type` (`batch`, `service-triggered`, `manual`), `entry_point`, `parameters` schema, `timeout_ms`, `retry_policy`, `created_at`.
- **Lifecycle States**: `pending`, `running`, `succeeded`, `failed`, `canceled`, `expired`.
- **Execution Context**: references to repo/app, environment variables, secrets (fetched via future secret store integration), resource profile.

### Workflow Definition
- **Schema**: `id`, `slug`, `name`, `version`, `description`, `steps`, `triggers`, `created_at`.
- **Steps**: ordered or DAG-based nodes referencing job definitions or registered services. Each step defines dependencies, retry/rollback strategy, and payload mapping.
- **Triggers**: events (repo registered, service health change), schedules (cron), or manual invocations.
- **Artifacts**: shared storage for step outputs (Postgres JSONB, object storage pointers) to pass context between jobs/services.

## Data Model Changes
1. **Tables**
   - `job_definitions` capturing metadata and default parameters.
   - `workflow_definitions` storing composition and triggers.
   - `job_runs` recording each execution attempt with foreign keys to definitions, status timestamps, metrics (duration, logs pointer).
   - `workflow_runs` capturing orchestration state, current step pointer, aggregated status, emitted events.
   - `workflow_run_steps` bridging runs to individual job/service executions and storing input/output payloads.
2. **Indexes** for querying by slug, status, created_at.
3. **Migration Strategy**: Add tables via new migration files, ensure existing ingestion/build data remains untouched.

## API Surface
### Job Endpoints
- `POST /jobs` to register definitions (authorized).
- `GET /jobs` & `GET /jobs/:slug` for discovery.
- `POST /jobs/:slug/run` to enqueue manual executions with parameter overrides.
- `GET /jobs/:slug/runs` for history.

### Workflow Endpoints
- `POST /workflows` to register composed workflows.
- `GET /workflows` & `GET /workflows/:slug` for discovery.
- `POST /workflows/:slug/run` for manual trigger.
- `GET /workflows/:slug/runs` and `GET /workflow-runs/:id/steps` for monitoring.

### Event Stream Extensions
- Extend WebSocket feed with `job.run.*` and `workflow.run.*` topics mirroring ingestion event payloads.
- Include aggregated metrics (duration, step statuses) for UI updates.

## Worker & Scheduler Changes
1. **BullMQ Queue Strategy**
   - Create dedicated queues (`job:default`, `workflow:orchestrator`), or reuse existing Redis instance with namespacing.
   - Support delayed jobs, concurrency limits, and retry policies defined per job.
2. **Workflow Orchestrator Worker**
   - Consumes workflow run requests, resolves step graph, enqueues dependent jobs, monitors completion, and applies failure policies (retry, skip, halt).
   - Manages data hand-off via shared context stored in Postgres or Redis.
3. **Job Runner Abstractions**
   - Wrap existing ingestion/build workers with a generic execution adapter so they can be invoked as workflow steps.
   - Define a contract (`execute(JobRunContext) -> JobResult`) to unify logging and metrics.
4. **Service Invocation Steps**
   - For service-type steps, integrate with service registry to discover connection details and authentication requirements.
   - Provide HTTP/gRPC invocation helpers with standardized timeout/retry behavior.

## Frontend & Operator Experience
- Add UI sections for job/workflow catalog, run history, and live status updates.
- Provide launch modals for manual executions with parameter forms generated from JSON schema.
- Surface workflow DAG visualization, step timelines, and log links.
- Offer filtering/search by status, repo, service, and tags to aid troubleshooting.

## Observability & Logging
- Persist structured logs per job run (link to object storage or log aggregation service).
- Collect metrics: run counts, success rate, average duration, failure reasons.
- Integrate with existing event stream to notify frontend and CLI tools.
- Provide alert hooks (webhooks, PagerDuty) when workflows fail repeatedly.

## Security & Permissions
- Enforce auth on registration and manual execution endpoints (future integration with service tokens or user roles).
- Validate parameter schemas to prevent arbitrary command execution.
- Audit log workflow modifications and manual runs.

## Backward Compatibility
- Existing ingestion/build operations continue to function; their implementations register as default job definitions during migration.
- API responses maintain current fields, with optional extensions for workflows.
- UI additions are additive; existing search and repo views remain unchanged.

## Open Questions
1. How should secrets be managed for jobs/workflows? (Potential secret manager integration.)
2. What isolation guarantees are required for service steps (namespaces, per-run containers)?
3. How granular should step rollback semantics be (compensation vs. idempotent retries)?
4. Should workflows support long-running services with heartbeats, or remain batch-only for MVP?
5. How will we version and migrate workflow definitions across environments (dev/stage/prod)?

## Implementation Phases
1. **Foundations**: schema migrations, job definition API, basic job runner abstraction.
2. **Workflow MVP**: orchestrator worker, workflow definitions, manual triggers, UI read-only views.
3. **Service Integration**: call registered services within workflows, add health-aware retries.
4. **Advanced UX**: DAG visualizations, parameterized launch forms, notification preferences.
5. **Hardening**: auth, secrets, observability integration, SLA monitoring.

