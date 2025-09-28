# Ticket 133 – Metastore Explorer Query Composer & Server-Driven Search

## Summary
Replace the explorer’s local filtering with a server-backed search experience that leverages the new `q` grammar and presets, offering both a guided query builder and an advanced DSL editor for power users.

## Motivation
Client-side filtering is inaccurate once pagination exceeds the initial page and forces the UI to over-fetch records. By moving filtering to the backend and giving users intuitive tooling to compose queries, we maintain accuracy, reduce payload size, and expose more of the metastore’s expressive search capabilities.

## Scope
- Introduce a visual query builder with dropdowns for common fields (key, tags, owner, metadata paths) and operators; emit `q` strings or full DSL payloads depending on complexity.
- Add a “presets” menu (recently updated, soft-deleted, stale >30d, etc.) that maps to backend `preset` names.
- Provide an “Advanced” toggle exposing raw DSL JSON editing with validation and syntax highlighting; errors surface inline with documentation links.
- Update the search fetcher to rely exclusively on backend pagination (remove local filtering/limit overrides) and request lean projections once Ticket 134 lands.
- Persist the last-used query in URL params so views are shareable.

## Acceptance Criteria
- The explorer fetches only the requested page from the backend; pagination totals match server responses even under complex filters.
- Query builder interactions produce the expected backend payloads, verified via unit tests and mocked fetch assertions.
- Advanced DSL editor validates input before submission and restores the previous query on cancel.
- QA covers transitions between presets, builder, and advanced editor without losing context.

## Dependencies / Notes
- Depends on Tickets 130, 132, and 134 for backend capabilities.
- Partner with design for builder UX and error handling.
