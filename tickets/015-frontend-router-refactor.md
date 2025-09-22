# Ticket 015: Router-Driven Frontend Navigation

## Summary
Replace the legacy tab-based navigation in the AppHub frontend with a modern client-side router that provides canonical URLs for each application surface and removes bespoke localStorage bookkeeping.

## Problem Statement
The current `App.tsx` component manually manages tab state, persists it to `localStorage`, normalizes historical slug aliases, and renders every view conditionally. This approach prevents deep-linking, complicates onboarding for new surfaces, and requires ongoing maintenance of legacy tab mappings. Moving to a router-backed architecture will deliver URL-driven navigation, simplify state persistence, and allow us to delete the legacy tab plumbing once consumers migrate.

## Goals & Scope
- Introduce a router (React Router or TanStack Router) that maps dedicated routes to the catalog, services, workflows, imports, and API access screens.
- Preserve backwards compatibility for existing external links by supporting redirects from the legacy `submit`/`import-manifest` slugs during the transition window.
- Replace `localStorage`-driven tab persistence with router state so refreshes and direct links resolve to the correct view without custom logic.
- Delete `normalizeStoredTab`, bespoke `useEffect` wiring, and conditional render scaffolding after all views are wired through the router.
- Update navigation UI components to use link primitives from the router rather than manual `setActiveTab` handlers.
- Document the new route structure and migration plan in `docs/` for downstream teams.

## Non-Goals
- Rewriting feature-specific pages (catalog search, workflow builder) beyond adapting them to the router entry points.
- Building server-side rendering or SEO optimizations in this iteration.
- Introducing URL parameters for every nested modal; initial focus is on top-level route segmentation.

## Acceptance Criteria
- Navigating directly to `/catalog`, `/services`, `/workflows`, `/import`, and `/api` renders the appropriate view without manual tab toggles.
- Refreshing any route preserves the active surface with no reliance on `localStorage` keys.
- Legacy `/submit` and `/import-manifest` URLs redirect to `/import` with a deprecation console warning and analytics event.
- All navigation elements in the header/sidebar use router-aware link components that apply active styling automatically.
- Manual tab management helpers (`normalizeStoredTab`, `setActiveTab`, related `useEffect` blocks) are removed from `App.tsx`.
- Documentation describing the new routing scheme and sunset timeline for legacy links is published.

## Implementation Notes
- Evaluate React Router v6 vs. TanStack Router based on bundle size, data loading needs, and existing team experience; document the decision.
- Create a top-level `RouterProvider` in `main.tsx` and break the previous conditional render sections into route components under `routes/`.
- Use router loaders or dedicated hooks to fetch per-view data where necessary, ensuring existing polling behavior continues to function.
- Add route guards for operator-only surfaces (workflows, imports) using existing auth context.
- Instrument telemetry to measure legacy alias usage so we can schedule removal once traffic drops.

## Dependencies
- Existing navigation components and layout shell from the current `App.tsx` implementation.
- Auth context utilities that expose operator scopes for gating protected routes.
- Documentation pipeline for publishing updated navigation guidance.

## Testing Notes
- Unit tests covering route configuration and redirects for legacy slugs.
- Frontend integration tests that navigate between routes and verify the correct view renders without `localStorage` interference.
- Manual QA checklist ensuring deep links work in supported browsers and the router integrates with analytics/tracking hooks.

## Deliverables
- Updated frontend codebase with router integration and removal of legacy tab management logic.
- Redirect telemetry dashboard or analytics event summary demonstrating alias usage post-launch.
- Documentation updates outlining route structure, redirect strategy, and rollout notes for stakeholders.
