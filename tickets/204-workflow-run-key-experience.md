# Ticket 204: Surface Run Keys in UI and Documentation

## Problem
Even with backend support, operators and developers will not benefit from human-readable run keys unless the frontend, docs, and runbooks highlight them. Current UI components only display the UUID, and existing docs reference `runId` exclusively. We need to update user-facing surfaces to promote the new identifier and explain usage.

## Proposal
- Update workflow run history, detail panels, and live status overlays to show run keys alongside UUIDs, with copy-to-clipboard helpers.
- Adjust filters/search to accept either identifier, defaulting to run key when available.
- Refresh Docs/runbooks (e.g., workflow heartbeat recovery) to reference run keys, including guidance on deriving keys for manual interventions.
- Add QA scenarios and screenshots demonstrating the new display and search behavior.
- Coordinate release notes and internal announcements so support teams expect the change.

## Deliverables
- Frontend PRs covering component updates, search enhancements, and tests.
- Documentation updates in `docs/` and runbooks referencing run key usage.
- Screenshot assets or Storybook updates illustrating new UI.
- Communication plan draft for release notes and support playbooks.

## Risks & Mitigations
- **UI clutter:** Provide sensible fallbacks (hide run key when absent) and ensure layout adapts responsively; involve design in review.
- **Search confusion:** Maintain backward compatibility by accepting UUIDs; add tooltips clarifying which identifier is which.
- **Doc drift:** Schedule doc updates alongside code deployment; add checklist item to release plan.
