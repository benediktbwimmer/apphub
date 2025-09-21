# Ticket 004: Advanced Workflow & Job UX

## Summary
Deliver operator-facing UX improvements that make jobs and workflows discoverable, configurable, and understandable, including DAG visualizations and launch forms.

## Problem Statement
With core orchestration working, operators lack ergonomic tooling to inspect complex workflows, launch jobs with parameters, and monitor progress visually. Rich UX is required to unlock day-to-day adoption.

## Scope & Requirements
- Implement frontend pages/components for job catalog browsing, manual run initiation with JSON schema–driven forms, and run detail views.
- Build workflow visualization (DAG graph) showing dependencies, current statuses, and timing data leveraging the event stream.
- Add filtering/search UI for jobs and workflows by status, repo, service, and tags.
- Expose log links and aggregated metrics in the UI for both job runs and workflow steps.
- Update documentation to guide operators through the new UI surfaces.

## Non-Goals
- Backend API or orchestrator changes beyond what is necessary to support the UI (e.g., new endpoints should already exist from prior tickets).
- Alerting/notification configuration (handled later).

## Acceptance Criteria
- UI allows an operator to discover a workflow, inspect its DAG, and follow a running execution with live updates.
- Manual launch forms validate parameters client-side and submit to the existing APIs.
- Filtering/search respond in under 250ms against representative datasets.
- Documentation includes screenshots or walkthroughs of the new UX.

## Dependencies
- Tickets 001–003 to supply APIs/events and workflow context data.

## Testing Notes
- Add frontend integration tests (React Testing Library/Cypress) covering manual launch flows and DAG rendering.
- Run accessibility checks on new UI components.
