# Ticket 700: Expand Semantic Theme Tokens Across Frontend Modules

## Problem
Core shared components now consume semantic tokens, but feature modules still embed raw Tailwind colour and typography utilities. Without migrating these areas, tenants will encounter inconsistent themes and future palette updates will require repetitive, error-prone edits.

## Proposal
- Audit application feature directories (catalog, events, metastore, jobs, workflows, timestore, settings) and replace ad-hoc Tailwind colour/size classes with token-driven utilities (surface, text, border, status, typography).
- Extract shared variants/utilities where repeated combinations emerge (e.g., status badges, table headers) to promote reuse.
- Leverage the semantic lint rule to block regressions, adding overrides only where third-party component APIs require embedded colours.

## Deliverables
- Refactored components across feature modules using the semantic utility set (`bg-surface-*`, `text-scale-*`, status tokens, etc.).
- Shared helpers for repeated patterns (badges, empty states) that encapsulate token usage.
- Documentation callouts (or changelog entry) summarising updated utilities for feature teams.

## Risks & Mitigations
- **Large diff surface:** Break migration into workspace-scoped PRs to ease review. Use codemods/search-replace to handle obvious class swaps.
- **3rd-party component constraints:** Where colour props are required, wrap the component or configure CSS variables instead of falling back to hex values.
