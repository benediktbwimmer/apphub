# Ticket 087: Retry Operations UI & Observability

## Problem Statement
After durable retries are in place for events, triggers, and workflow steps, operators need guardrails: insight into pending retries, the ability to cancel or force-run them, and alerts when backlog grows. Without UI and metrics, the durability work remains opaque.

## Goals
- Extend the admin UI (`/admin/event-health`, workflow detail pages) to surface retry queues, attempts, next-attempt timestamps, and warning indicators for runs.
- Add API endpoints/actions for cancelling or force-running retries (event, delivery, workflow step).
- Emit structured events/metrics that track retry lifecycle (scheduled, rescheduled, exhausted, cancelled) and set default alerts/dashboard templates.

## Non-Goals
- Core retry scheduling logic (handled in prior tickets).
- Feature flags/kill switches beyond exposing configuration toggles for UI display.

## Implementation Sketch
1. **API layer**
   - Add endpoints to list retries, cancel, and force-run specific entries.
   - Ensure authorization checks align with existing workflows permissions.

2. **UI**
   - Update admin event health page to show retry status, overdue badges, and controls.
   - Mark workflow runs with retries as “degraded” and expose detail views.

3. **Observability**
   - Extend metrics/alerts to monitor retry backlog size, oldest scheduled retry, and success/exhaustion rates.
   - Provide documentation for new dashboards and recommended alert thresholds.

## Deliverables
- API + UI changes for managing retries.
- Metrics/alerts documentation and initial dashboards.
- Updated docs describing operator workflows and feature toggles.
