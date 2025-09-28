# Ticket 101: Build Events Explorer Frontend

## Problem
Even with improved backend feeds, the frontend has no dedicated place to browse live platform events. Operators currently hop between workflow triggers, catalog history, and admin endpoints, which fragments situational awareness.

## Proposal
- Create a new `/events` surface in the frontend that consumes the websocket feed and `/admin/events` history endpoint.
- Implement filtering (source, type, severity, correlation id, time window) with quick chips and saved view presets.
- Render a real-time list with virtualized rows, highlighting new arrivals, and expose a detail drawer showing envelope metadata, payload, and related resource links.
- Reuse the existing event schema explorer to power JSONPath suggestions inside the filter UI.

## Deliverables
- React route, state hooks, and components for the events feed, filters, and detail drawer.
- Integration with `AppHubEventsProvider` for live updates plus fallback polling when disconnected.
- Unit/Vitest coverage for filter logic and component rendering, plus e2e smoke test to ensure the view renders with fixture data.
- UX polish (keyboard navigation, dark mode, empty/error states) aligned with existing operator surfaces.

## Risks & Mitigations
- **UI overload:** Start with a focused MVP (core filters + detail drawer) and gather operator feedback before layering advanced analytics.
- **Performance:** Use virtualization and incremental history loading to avoid choking on bursts; include telemetry to monitor client impact.
