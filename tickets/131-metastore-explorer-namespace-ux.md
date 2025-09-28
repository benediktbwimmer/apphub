# Ticket 131 – Metastore Explorer Namespace UX Enhancements

## Summary
Upgrade the explorer UI to consume the new namespace discovery API, provide autocomplete and favorites, and clearly communicate authorization gaps so operators stop guessing namespace strings.

## Motivation
Operators routinely work across multiple namespaces but the current UI offers only a free-text field. This causes typos, hidden data, and repeated calls to support when a namespace uses a non-obvious name. Surfacing an authoritative list with metadata and remembering user preferences shortens workflows and showcases governance signals.

## Scope
- Call `GET /namespaces` on load and when the namespace picker gains focus; surface results in a searchable dropdown with recent and favorite namespaces pinned to the top.
- Persist the user’s most recent namespaces (e.g., in local storage) and allow starring favorites for quick access.
- Highlight namespaces the token cannot access with disabled states and scoped explanations; provide inline actions to request access (link to docs or ticketing).
- Display namespace-level stats (record count, deleted count, last updated) in the picker tooltip or secondary text to help spot stale datasets.
- Fallback gracefully to manual entry if discovery is unavailable, showing an error toast and preserving current behavior.

## Acceptance Criteria
- Autocomplete displays only namespaces authorized for the active identity and updates after favorites change.
- Selecting a namespace updates the explorer without manual refresh; invalid or unauthorized namespaces produce clear messaging.
- Favorites persist across reloads and can be removed.
- Vitest/UI tests cover the picker behavior, including the discovery failure fallback.

## Dependencies / Notes
- Depends on Ticket 130 for backend support.
- Coordinate with design for dropdown styling and empty states.
