# Ticket 053: Add Timestore Operations Console

## Problem Statement
Beyond read-only insights, operators need to trigger lifecycle jobs, inspect queue health, and run ad-hoc queries from the UI. The Timestore API exposes lifecycle run/reschedule endpoints, retention updates, query execution, and Prometheus metrics, but none are surfaced in the frontend.

## Goals
- Extend the Timestore page with lifecycle controls (run, reschedule, retention update) wired to `/admin/lifecycle/run`, `/admin/lifecycle/reschedule`, and `/admin/datasets/:id/retention`.
- Embed an inline query console using `POST /datasets/:slug/query` with preset time-range helpers, result table, and JSON preview.
- Surface operational metrics (ingestion throughput, queue depth, latency) by parsing `/admin/lifecycle/status` and `/metrics` (when reachable) into charts or stat blocks.
- Capture audit events for lifecycle/retention actions using existing toast helpers and ensure optimistic feedback when REDIS inline mode is active.

## Non-Goals
- Building a full SQL editor; the console should focus on time-range guided queries.
- Implementing Prometheus scraping beyond a curated subset relevant to operators (timeouts render friendly messaging).
- Persisting saved queries (future enhancement).

## Implementation Sketch
1. Add lifecycle action components (`LifecycleControls`, `RetentionPanel`) that leverage `usePollingResource` for status updates and call the relevant admin APIs; handle inline vs queued modes based on response payload.
2. Construct a `QueryConsole` component that provides parameter inputs (dataset slug, time window, downsampling, limit) and renders results via shared table + sparkline components; reuse `JsonSyntaxHighlighter` for request/response details.
3. Create a lightweight Prometheus parser to extract key `timestore_*` metrics or rely on backend-provided summaries when metrics are disabled; map outputs to stat cards and mini charts.
4. Ensure scope checks gate controls (write/admin scopes), showing inline callouts when users lack permissions.
5. Write component tests for lifecycle action success/failure paths, inline queue detection, and query error handling.
6. Update docs (`docs/timestore-observability.md`) with screenshots or description of the operations console and note required scopes.

## Acceptance Criteria
- Operators with `timestore:admin` can trigger lifecycle runs, reschedule jobs, and edit retention from the UI with optimistic feedback and audit toasts.
- Query console executes requests, shows results or structured errors, and remembers the last dataset/time range during the session.
- Metrics cards display ingestion throughput and queue depth when `/metrics` is reachable, gracefully degrading when not.
- Tests cover lifecycle action flows and query console edge cases; lint/test commands succeed.
