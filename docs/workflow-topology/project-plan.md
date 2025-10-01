# Workflow Topology Explorer Project Plan

## Timeline Overview
| Phase | Ticket(s) | Owner | Start | Target Complete | Notes |
| --- | --- | --- | --- | --- | --- |
| Requirements Alignment | 090 | B. Nguyen | 2024-03-18 | 2024-03-18 | Workshop complete; outputs captured in `workshop-notes.md`. |
| Backend Assembly | 091 | D. Romero | 2024-03-19 | 2024-03-26 | Coordinate with asset materializer team for helper reuse. |
| API Exposure & Caching | 092 | S. Patel | 2024-03-25 | 2024-03-29 | Requires Redis cache config update; ops sign-off needed. |
| Frontend Data Layer | 093 | L. Flores | 2024-03-26 | 2024-04-02 | Ensure websocket client alignment with runtime overlay schema. |
| Rendering Foundations | 094 | M. Chen | 2024-03-25 | 2024-04-03 | Deliver decision record + reusable graph component. |
| UX & Interaction Polish | 095 | H. Armstrong (Design), M. Chen (Frontend) | 2024-04-01 | 2024-04-08 | Includes accessibility pass and detail drawer integration. |
| Live Status Overlay | 096 | L. Flores | 2024-04-05 | 2024-04-12 | Throttling strategy co-designed with core team. |
| QA & Rollout | 097 | P. Shah | 2024-04-10 | 2024-04-17 | Feature flag gating + operator enablement runbook. |

## Milestones
1. **Graph Contract Accepted** – 2024-03-19
   - Tickets: 090, 091
   - Deliverables: `graph-data-contract.md`, backend module scaffold.
2. **End-to-End Topology Fetch + Render** – 2024-04-05
   - Tickets: 091–095
   - Deliverables: API endpoint, frontend canvas rendering static graph, UX polish baseline.
3. **Live Operational Overlay** – 2024-04-12
   - Tickets: 093, 096
   - Deliverables: Event-driven overlays, throttling guardrails.
4. **GA Readiness** – 2024-04-17
   - Tickets: 095–097
   - Deliverables: Accessibility sign-off, QA checklist, rollout plan.

## Dependencies & Coordination
- **Shared Types**: Tickets 091 & 093 must agree on `packages/shared/workflow-topology.ts`; schema changes require notification to frontend.
- **Caching Strategy**: Ticket 092 depends on ops validating Redis cluster sizing; coordinate via Ops weekly sync.
- **Graph Library Decision**: Ticket 094 decision record blocks Ticket 095; spike scheduled 2024-03-22.
- **Event Stream**: Ticket 096 relies on core exposing runtime overlay channel; work tracked via ops backlog item `OPS-142`.

## Risks & Mitigations
- **Performance regressions**: Run Lighthouse + profiling after Tickets 094/095; capture baselines in QA ticket 097.
- **Scope creep from analytics**: All non-operational metrics pushed to stretch goals; escalate via product if required.
- **Dependency contention**: Asset materializer team is mid-release; confirm helper extraction timeline in engineering sync 2024-03-20.
- **Accessibility debt**: Design + frontend pair during Ticket 095 week to avoid late churn.

## Communication Plan
- Weekly project stand-up (Tues 10:00 PT) covering progress/risks.
- Async updates in `#apphub-workflows` channel every Friday.
- Demo checkpoint after milestone 2 with stakeholders from core + ops.
- Pre-GA review with support + documentation (Ticket 097 deliverable).

## Success Metrics
- Operators complete a lineage investigation in < 3 minutes (measured via UX study post-launch).
- 90% of workflows with auto-materialize policies visible with correct dependencies within the explorer.
- P95 graph API latency < 400 ms under production load.
- Zero accessibility blockers (WCAG AA) at launch.
