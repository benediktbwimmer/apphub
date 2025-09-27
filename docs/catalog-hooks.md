# Catalog Hook Layering

The catalog UI now composes four focused hooks instead of leaning on the old 1,200-line `useCatalog` monolith. Each hook owns an isolated domain and shares cross-cutting data through a thin set of repository mutators exposed by `useCatalogSearch`.

## Shared contract

`useCatalogSearch` exposes `repositories` with `replace`, `update`, and `merge` helpers alongside `setGlobalError`. Other hooks call these helpers rather than mutating catalog results directly. This keeps the search response as the single source of truth and limits rerenders to the slices that actually change.

## Hook breakdown

- **`useCatalogSearch`** – manages the search input, debounced queries, facet state, tag suggestions, sort behaviour, and highlight toggles. It is also responsible for socket-driven repository refreshes and for exposing the repository mutators to downstream hooks.
- **`useCatalogHistory`** – lazily loads ingestion history, tracks retry state, and listens for ingestion events. It reuses the search hook’s mutators to patch repository fields after retries and resets global catalog errors when retries fail.
- **`useCatalogBuilds`** – encapsulates timeline pagination, log hydration, build retries, and build creation. Build updates from the WebSocket feed reach the search results through the shared `update` mutator.
- **`useCatalogLaunches`** – drives launch list hydration, launch execution, stop requests, error surfacing, and live updates from the launch event stream. It relies on both `replace` (for full repository payloads) and `update` (for incremental launch summaries).

## Working with the hooks

Compose the hooks in `CatalogPage` (or any future catalog view) and pass the relevant state slices down to presentation components. New features should prefer extending the domain-specific hook that matches their concern. If a feature spans domains, add a new helper to the repository mutator contract rather than threading setters through multiple components.

When adding tests, target the specific hook—each now has a dedicated file under `apps/frontend/src/catalog/hooks/__tests__` so behaviour changes can be validated without standing up the entire page.
