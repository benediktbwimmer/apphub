# Ticket 001: Job Foundations

## Summary
Deliver the foundational capabilities required to treat ingestion/build operations as first-class "jobs" that run to completion. Establish persistence, APIs, and worker abstractions that every later workflow feature depends on.

## Problem Statement
AppHub currently operates ingestion and build runners with ad hoc metadata and limited history. We need a generalized job model so that any deterministic run-to-completion task can be registered, executed, and tracked through a consistent lifecycle.

## Scope & Requirements
- Create migrations that add `job_definitions` and `job_runs` tables with the schema outlined in the Jobs & Workflows specification.
- Seed default job definitions for existing ingestion/build behaviors as part of the migration or bootstrap routine.
- Implement Fastify handlers for `POST /jobs`, `GET /jobs`, `GET /jobs/:slug`, and `POST /jobs/:slug/run` with validation for parameter schemas, timeouts, and retry policies.
- Introduce a job execution abstraction that wraps the existing ingestion/build workers (`execute(JobRunContext) -> JobResult` contract) and stores run status, timestamps, metrics, and log pointers.
- Emit job lifecycle events (`job.run.*`) onto the existing WebSocket/event infrastructure.

## Non-Goals
- Workflow orchestration, DAG resolution, or service steps.
- UI updates beyond minimal API documentation.
- Authentication/authorization hardening (handled in a later ticket).

## Acceptance Criteria
- Database migrations are reversible and include indexes for job lookup by slug and status.
- API requests using representative payloads succeed/fail according to validation rules, with run records persisted for manual launches.
- Existing ingestion/build paths continue to operate via the new abstraction without regressions (smoke test via manual run).
- Events for job start/success/failure appear on the event stream with payloads matching the spec.

## Dependencies
- None (entry point for the epic).

## Testing Notes
- Add integration tests that call the new endpoints and assert run records are created.
- Exercise an ingestion job via the new API in a development environment.
