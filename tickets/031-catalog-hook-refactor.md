# Ticket 031: Decompose Catalog Search Hook

## Problem
`useCatalog` is a ~1,200 line hook that drives search input parsing, facets, build timelines, launch orchestration, and WebSocket updates. The monolithic structure makes it costly to extend (e.g., adding saved searches) and error-prone to maintain.

## Proposal
- Extract responsibility-specific hooks (search state, build timelines, launch control, history state) that can be composed within `CatalogPage`.
- Move repeated data-massaging helpers into shared utilities with unit coverage.
- Replace implicit shared mutable state with explicit providers to reduce rerender churn and race conditions.
- Add targeted tests for search parsing and launch orchestration flows once decoupled.

## Deliverables
- Modular hook structure with clear ownership per concern.
- Updated `CatalogPage` wiring and regression pass over catalog-related tests.
- Developer notes describing the new hook layering and extension points.

## Risks & Mitigations
- **State divergence:** Introduce integration tests (or Vitest component tests) to ensure builds/launches still hydrate correctly after refactor.
- **Scope creep:** Land refactor incrementally, starting with search state before moving to builds and launches.
