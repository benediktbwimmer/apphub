# Ticket 012: Enable Workflow DAG Scheduling and Parallel Step Execution

## Summary
Redesign the workflow engine so authors can define branching DAGs, run independent steps in parallel, and observe concurrent execution without losing existing workflow functionality.

## Problem Statement
Workflows currently execute strictly top-to-bottom; even when a step declares `dependsOn`, the orchestrator processes every step serially. This blocks common automation patterns such as fan-out/fan-in, leads to artificially long run times, and forces operators to linearize complex flows manually. We need native DAG support with safe concurrency controls so workflows can scale with real-world orchestration needs.

## Scope & Requirements
- Validate workflow definitions as DAGs during create/update:
  - ensure every `dependsOn` reference exists
  - reject cycles and duplicate ids
  - store normalized adjacency metadata for runtime use.
- Replace the serial orchestrator loop with a scheduler that:
  - builds a ready queue from the DAG, launching all steps whose dependencies succeeded
  - tracks in-flight steps and awaits only the active branch set
  - supports configurable concurrency caps per workflow run (default derived from `WORKFLOW_CONCURRENCY`).
- Decouple step execution from synchronous blocking:
  - persist step state transitions safely when job/service handlers run asynchronously
  - reconcile shared context writes without race conditions (row-level locking or per-step context shards).
- Update job and service step adapters to cooperate with parallel scheduling (e.g., avoid overwriting `workflow_runs.context` wholesale, emit step completion signals).
- Extend API and event payloads so clients can see multiple running steps and accurate dependency metadata.
- Document the new DAG behavior for operators, including examples of branching, fan-out, and merge patterns.

## Research & Exploration
- Evaluate using BullMQ features (rate limiting, priorities) to offload parts of the scheduler vs. keeping orchestration in-process.
- Assess whether Postgres advisory locks or JSON patch strategies offer the best balance for concurrent context updates.
- Review existing job sandbox/runtime constraints to confirm they remain safe under parallel invocation.
- Prototype DAG validation on a sample workflow to benchmark performance and error messaging needs.

## Acceptance Criteria
- Creating or updating a workflow with missing dependencies or cycles returns a 400 with actionable errors.
- Running a workflow with independent branches shows overlapping step execution and reduced total duration compared to serial runs.
- Workflow run detail responses and event streams surface each step’s status without lost updates when steps finish concurrently.
- Regression tests cover fan-out (one node to many) and fan-in (many to one) scenarios for both job and service steps.
- Documentation in `docs/architecture.md` (or new section) explains DAG scheduling, concurrency limits, and context merge semantics.

## Dependencies
- Stable job runtime interfaces; any planned changes to sandbox execution must be finalized to avoid duplicate effort.
- Redis capacity sized for increased concurrent step activity.
- Observability pipeline able to ingest higher event volume from parallel runs.

## Open Questions
- Do we need per-step concurrency limits or priorities beyond simple DAG readiness?
- Should we expose workflow-level throttles (max parallel steps, resource classes) in the definition schema?
- How should retries interact with downstream branches that may already be running—do we roll back dependents or support partial replays?

## Testing Notes
- Add orchestration-focused unit tests for DAG validation and scheduler readiness calculations.
- Extend end-to-end workflow tests to assert concurrent completion ordering and correct dependency enforcement.
- Include load-oriented tests to measure performance gains and guard against Redis/DB hotspots under parallel execution.
