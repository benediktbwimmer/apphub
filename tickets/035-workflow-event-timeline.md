# Ticket 035: Add Workflow Event Timeline View

## Problem
Operators can inspect runs, triggers, and scheduler health separately, but there is no single timeline overlaying workflow runs with trigger deliveries and scheduler signals. Correlating issues requires jumping between multiple panels.

## Proposal
- Build a timeline component that plots workflow runs alongside trigger delivery events and scheduler health snapshots.
- Reuse existing event trigger data and `workflow.event.received` records to populate the timeline.
- Provide filtering by workflow slug, time range, and trigger status to isolate incidents.
- Add API/route support if needed to batch-fetch events efficiently.

## Deliverables
- Timeline UI integrated into the workflows surface (likely as a new tab or panel).
- API additions (if required) to supply aggregated event/run data.
- Documentation/update notes highlighting the new troubleshooting aid.

## Risks & Mitigations
- **Data volume:** Implement server-side pagination or range queries to keep timelines performant.
- **UX complexity:** Run usability pass with operators to validate the layout before broad rollout.
