# Ticket 034: Improve Filestore Mount Selection UX

## Problem
`FilestoreExplorerPage` assumes mount ID `1` and stores IDs locally without verifying availability. Multi-mount deployments or mismatched IDs force operators to manually adjust state, and selections are not persisted per user.

## Proposal
- Fetch available backend mounts from the API on load and drive selection from the returned metadata.
- Persist the last-selected mount (e.g., via local storage or user settings) so operators resume where they left off.
- Surface a clear empty state when no mounts are configured and guide the operator to docs or CLI commands.
- Add minimal analytics counters to monitor mount switching.

## Deliverables
- Updated filestore explorer with dynamic mount discovery and persistence.
- Regression tests covering mount selection and fallback states.
- Documentation snippet (settings or release notes) describing the improved experience.

## Risks & Mitigations
- **API availability:** Ensure the explorer handles API failures gracefully with retry affordances.
- **Backward compatibility:** Maintain default selection behavior when only one mount is available.
