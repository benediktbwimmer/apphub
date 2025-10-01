# AppHub Frontend Router Migration

## Overview
AppHub's frontend now relies on React Router to manage primary navigation instead of the legacy tab implementation. The team already ships other React Router surfaces, giving us mature patterns with minimal bundle impact. URL paths map directly to each product surface, enabling deep links, native refresh behaviour, and a simplified state model.

## Canonical Routes
The router defines the following top-level paths:

- `/core` – core search and management experience.
- `/services` – service gallery (previously the “Apps” tab).
- `/workflows` – operator workflow management surface (guarded).
- `/import` – import workspace for manifests, apps, and jobs (guarded).
- `/api` – API access and token management.

Visiting `/` redirects to `/core`.

## Legacy Redirects
Historical entry points `/submit` and `/import-manifest` now redirect to `/import`. A console warning is emitted and an analytics event (`navigation_legacy_redirect`) records the redirect source so downstream dashboards can monitor remaining traffic.

## Operator Route Guards
Both `/workflows` and `/import` require an operator token. If no stored tokens are detected the router logs a warning, fires an `operator_route_guard_blocked` analytics event, and redirects to `/api`. This ensures unauthenticated users land on the page where they can provision credentials.

## Navigation UI
The primary navigation uses router links and active styling is driven by the current location. No `localStorage` persistence is required; URLs are the source of truth.

## Migration Plan
- Update any bookmarks or documentation to reference the canonical paths listed above.
- Monitor the `navigation_legacy_redirect` analytics metric. When traffic approaches zero the `/submit` and `/import-manifest` shims can be removed.
- Notify operator teams that tokens are required to access `/workflows` and `/import`; linking users to `/api` will walk them through token setup.

These changes remove bespoke tab bookkeeping while preserving continuity for legacy URLs during the transition period.
