# Ticket 049: Timestore Ingestion & Lifecycle History UI

## Problem Statement
Operators lack visibility into recent ingest attempts and lifecycle activity from the timestore UI. Although metrics and audit rows exist server-side, the dataset detail pane only shows manifests and retention, forcing teams to inspect logs or the database when troubleshooting failures.

## Goals
- Surface recent ingestion events (success/failure, actor, mode, duration) and lifecycle job history directly within the dataset detail page.
- Link audit records to manifest IDs, job IDs, or queue entries so operators can drill into details quickly.
- Provide scoped access so only users with `timestore:admin` (or read scope, as appropriate) can view sensitive history.

## Non-Goals
- Building a full observability dashboard; defer aggregate metrics to existing Prometheus/Grafana views.
- Supporting advanced search/filtering beyond recent history and simple filters initially.

## Implementation Sketch
1. Consume the new dataset access audit API to fetch the latest ingest/query events, rendering a timeline with status badges and expandable metadata.
2. Extend lifecycle status polling to show richer job context (operations executed, actor, duration) and allow navigation to job details if available.
3. Display actionable messaging when scopes are missing, prompting users to request access.
4. Add tests covering the rendering of history entries, empty states, scope gating, and error handling when the API returns failures.
5. Optimize network usage by sharing fetchers/polling intervals between history components and existing detail sections.

## Deliverables
- Timeline components for ingest/query audit events and lifecycle job history integrated into the dataset detail UI.
- Scope-aware rendering with informative empty/error states.
- Automated tests confirming history rendering, pagination handling, and scope restrictions.
