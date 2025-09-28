# Workflow Topology Alignment Workshop

## Session Overview
- **Date**: 2024-03-18
- **Duration**: 90 minutes
- **Facilitator**: B. Nguyen (Product)
- **Participants**: Catalog (S. Patel, D. Romero), Frontend (L. Flores, M. Chen), Design (H. Armstrong), Ops (C. Rivera), QA (P. Shah)
- **Objective**: Establish the primary jobs-to-be-done, data needs, and UX guardrails for the upcoming workflow topology explorer.

## Operator Jobs-to-Be-Done
1. **Trace data lineage** from external events to downstream assets and services to understand impact windows.
2. **Identify scheduling bottlenecks** caused by conflicting triggers or overlapping cron windows.
3. **Diagnose stale assets** by visualizing producer/consumer relationships and freshness indicators.
4. **Audit workflow coverage** across business domains and surface orphaned workflows without triggers.

## Interaction Principles
- Graph must support pan + zoom, search, and keyboard navigation; no static diagrams.
- Node click surfaces a detail panel with actionable metadata and deep links (workflow definition, latest run, asset history).
- Filters for workflow slug, asset ID, event source, and status badges; combine multiple filters without losing context.
- Live status overlays show runs, trigger health, and asset freshness but can be toggled off for clarity.
- Accessibility baseline: focus outlines on all interactive elements, 4.5:1 contrast, and ARIA structuring for screen readers.

## Non-Functional Requirements
- Initial render < 1.5s for graphs up to 150 workflows, 600 steps, 400 assets.
- Incremental update cadence ≤ 2s for high-volume event streams with throttling to prevent UI thrash.
- Backend graph assembly must not exceed 500 ms P95 under cache-hit conditions; cache warm-up triggered on definition/trigger/asset mutation.
- Graph payload versioned (`v1`) with compatibility notes for future evolution.

## Data & Metadata Needs
- **Node types**: workflow, step, trigger (event + schedule), asset, external event source.
- **Edges**: trigger→workflow, workflow→step (DAG), step→asset (produces/consumes), asset→workflow (auto-materialize dependency), event source→trigger.
- Each node includes tags: owner/team, domain, environment (dev/stage/prod), SLO references.
- Runtime overlay requires latest run status, run timestamps, failure count last 24h, asset freshness TTLs, trigger pause state.
- Partition metadata (time window vs static vs dynamic) surfaced for assets, with derived window hints when available.

## Open Questions & Follow-Ups
- Ops to confirm whether cross-tenant visibility restrictions apply for managed offerings (ticket #TBD).
- Design to explore miniature timeline treatment inside detail drawer for dense workflows (prototype due 2024-03-25).
- Frontend to spike on Cytoscape.js vs visx DAG layout before Ticket 094 decision record.
- Catalog to publish event schema for `workflow.analytics.snapshot` to evaluate overlay reuse.

## Risks / Mitigations
- **Large datasets causing UI lag** → introduce sampling + progressive reveal for >800 nodes, documented in Ticket 094.
- **Consistency gaps between asset materializer graph and new payload** → share canonicalization helpers (Ticket 091).
- **Live updates overwhelming clients** → apply server-side batching and client throttling (Ticket 096).
- **Scope creep on analytics overlays** → treat non-operational metrics (success rates > 7 days) as out-of-scope for v1.

## Decisions Logged
- MVP focuses on production environment; env filter toggles stage/sandbox but defaults to prod.
- Detail drawer is the primary surface for metadata; modals reserved for destructive actions.
- Graph payload delivered as JSON with compressed option via `Accept-Encoding: br` for large responses.
- Feature will ship behind `workflow_topology_explorer` flag with staged rollout (Ticket 097).

## Next Actions
- Ticket 091 kickoff: D. Romero (Catalog) – start 2024-03-19
- Ticket 094 spike assignment: L. Flores (Frontend) – decision record draft 2024-03-22
- Design prototype review: H. Armstrong – share Figma exploration 2024-03-25
- Ops policy note: C. Rivera – confirm cross-tenant stance 2024-03-26
