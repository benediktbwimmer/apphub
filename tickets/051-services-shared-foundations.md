# Ticket 051: Establish Shared Services Foundations

## Problem Statement
Timestore and Metastore pages require consistent auth-scoped fetch helpers, environment configuration, and toast UX. Today, service calls assume the catalog base URL, scope metadata stops at jobs/workflows, and polling logic is bespoke per screen. Without shared plumbing we risk duplicated timers, incorrect tokens, and undocumented scopes.

## Goals
- Extend `apps/frontend/src/config.ts` to expose `TIMESTORE_BASE_URL` and `METASTORE_BASE_URL`, sourced from `VITE_TIMESTORE_BASE_URL` / `VITE_METASTORE_BASE_URL` with sensible defaults.
- Update `ApiAccessPage` scope metadata and copy to include the new service scopes and guidance on when to mint them.
- Introduce a reusable `usePollingResource` (or equivalent) hook that wraps `useAuthorizedFetch`, supports AbortControllers, interval refresh, and manual invalidation.
- Centralize destructive-action toast helpers so future service pages reuse consistent success and error messaging.

## Non-Goals
- Hooking the new config values into backend proxies.
- Rewriting existing catalog polling screens beyond swapping to the new hook where low-effort (catalog refactor can happen later).
- Adding GraphQL or alternative data layers.

## Implementation Sketch
1. Expand `config.ts` and document the new env vars in the frontend README.
2. Update `SCOPE_METADATA` in `ApiAccessPage.tsx`, adding descriptions for `timestore:*` and `metastore:*` scopes plus inline links to docs.
3. Implement `usePollingResource` in `apps/frontend/src/hooks/`, including typing for fetchers, stale handling, and cleanup on unmount.
4. Refactor `ServiceGallery` to use the new hook as a proving ground, ensuring behavior parity.
5. Add toast helper utilities (e.g., `pushSuccess`, `pushError`) that encapsulate consistent copy and incorporate them where destructive actions currently display bespoke messages.
6. Cover the hook with unit tests (Vitest) to ensure intervals stop on unmount and errors propagate predictably.

## Acceptance Criteria
- Setting `VITE_TIMESTORE_BASE_URL` / `VITE_METASTORE_BASE_URL` affects all service fetches without resorting to string concatenation in components.
- `ApiAccessPage` lists and explains the new scopes, and tests verify ordering/availability.
- `usePollingResource` powers `ServiceGallery` polling with identical UX to the previous implementation and passes new hook tests.
- Toast helpers exist and no longer require every component to hand-roll success/error messages for destructive flows.
