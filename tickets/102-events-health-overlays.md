# Ticket 102: Add Event Health & Saved Views Enhancements

## Problem
Once the core explorer exists, operators still lack context on source health, retry backlogs, and curated perspectives for their teams. Without surfaced metrics and shareable filters, the explorer will devolve into a raw log viewer.

## Proposal
- Integrate the event scheduler health snapshot into the explorer as a collapsible metrics rail showing per-source lag, throttling, and retry counts.
- Visualize queue backlogs for source, trigger, and workflow-step retries with overdue indicators and deep links to existing admin actions.
- Implement saved views so teams can pin their common filters (e.g., “filestore reconcile”) and optionally share them across the org.
- Add lightweight analytics (event rate, error ratio) for each saved view using aggregated history queries.

## Deliverables
- Frontend components for the health rail, backlog widgets, and saved view management (create/update/delete).
- API endpoints or reuse of existing ones to persist saved view definitions (consider `packages/shared` for typings).
- Tests covering saved view persistence, metric rendering, and conditional UI states.
- Update operator docs with guidance on using health overlays and saved views.

## Risks & Mitigations
- **Data staleness:** Refresh health snapshots on an interval and surface timestamps so operators know when data was last updated.
- **Scope creep:** Keep initial saved view functionality minimal (filter + name + visibility) and defer advanced sharing rules to follow-on work.
