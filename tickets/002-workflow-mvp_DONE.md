# Ticket 002: Workflow MVP Orchestrator

## Summary
Implement the first version of workflow orchestration so operators can register workflows, trigger them manually, and observe step-by-step progress across jobs and services.

## Problem Statement
With foundational job primitives in place, AppHub lacks a way to compose jobs into higher-order workflows. We must provide definition storage, orchestration logic, and read APIs to make multi-step pipelines possible.

## Scope & Requirements
- Add migrations for `workflow_definitions`, `workflow_runs`, and `workflow_run_steps` with fields described in the specification (steps, triggers, current status, payloads).
- Build Fastify handlers for `POST /workflows`, `GET /workflows`, `GET /workflows/:slug`, `POST /workflows/:slug/run`, and read endpoints for run histories and step details.
- Introduce a workflow orchestrator worker (BullMQ queue) that resolves step dependencies, enqueues job runs, tracks completion, and records outputs in shared context storage.
- Emit workflow lifecycle events (`workflow.run.*`) including aggregated status, current step, and metrics.
- Provide minimal operator UX in the frontend to list workflows and view run history (read-only) leveraging the new APIs/events.

## Non-Goals
- Service invocation helpers beyond simple HTTP triggers.
- Scheduling/trigger automation (cron, repo events) beyond manual launches.
- Advanced visualization or parameterized forms.

## Acceptance Criteria
- Workflows with linear steps can be created, manually triggered, and complete successfully when dependent jobs finish.
- Workflow and step run records persist accurate timing, status, and output metadata.
- Event stream includes workflow start/success/failure updates consumable by the frontend.
- Frontend exposes a list/detail view showing workflow definitions and run history without regressions to existing pages.

## Dependencies
- Ticket 001 (Job Foundations) for job definitions, run API, and execution abstraction.

## Testing Notes
- Add orchestrator unit/integration tests covering success and failure paths, including retries.
- Exercise a two-step workflow locally and verify API/event payloads.
