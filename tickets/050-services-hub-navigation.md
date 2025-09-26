# Ticket 050: Build Services Hub Navigation Layout

## Problem Statement
The existing `/services` route renders a single gallery that no longer represents the broader operator experience. With Timestore and Metastore now part of the platform, we need a services hub that supports multiple sub-surfaces, persistent headers, and deep links while maintaining backwards-compatible entry points.

## Goals
- Introduce a `ServicesLayout` with secondary navigation pills that switch between Overview, Timestore, and Metastore routes.
- Move the current `ServiceGallery` view to `/services/overview` and ensure `/services` redirects there.
- Preserve the primary navigation item but update router configuration, loader boundaries, and zero states to handle unauthorized or offline services gracefully.
- Cover keyboard navigation and screen-reader labels so sub-routes remain accessible.
- Add router/Vitest coverage that asserts redirects, error boundaries, and focus management when switching tabs.

## Non-Goals
- Implement service-specific data fetching (covered in later tickets).
- Redesign the gallery cards themselves.
- Modify backend proxies or service health endpoints.

## Implementation Sketch
1. Add a `ServicesLayout` component that wraps secondary navigation, hero header, and `Outlet` content.
2. Update `appRouteConfig` to nest `/services/overview`, `/services/timestore`, and `/services/metastore`; ensure legacy `/services` visits redirect to `/services/overview`.
3. Extract a `ServicesNavTabs` component that mirrors `Navbar` styling and highlights the active sub-route.
4. Add scoped error boundaries/loading fallbacks for the services subtree to display authentication or connectivity guidance.
5. Port existing tests to the new structure and add coverage for redirects, active state styling, and focus restoration when using keyboard navigation.

## Acceptance Criteria
- Navigating to `/services` lands on the Overview tab and shows the existing gallery unchanged.
- Sub-tabs are keyboard focusable, announce active states via ARIA, and preserve scroll position when switching routes.
- Visiting `/services/timestore` or `/services/metastore` renders slot placeholders (until their pages land) without 404s.
- Router tests pass and demonstrate the redirect + error boundary behavior.
