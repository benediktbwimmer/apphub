# Ticket 600: Establish Shared Theme Token Foundations

## Problem
AppHub's frontend hard-codes colors and gradients across Tailwind classes, bespoke CSS, Monaco, and ReactFlow. Without a shared token source we duplicate palette tweaks, cannot express tenant-specific branding, and risk drift between dark and light implementations.

## Proposal
- Add `packages/shared/design-tokens` exporting strongly typed primitives (palette, typography, spacing) and semantic tokens (`surface.panel`, `text.muted`, `accent.primary`).
- Define default light and dark variants plus a mechanism for derived themes, keeping TypeScript-first ergonomics for consumers.
- Document token naming rules and contribution guidelines in the package README so teams introduce future tokens consistently.

## Deliverables
- New shared package with token definitions, type guards, and unit tests validating shape and fallback behaviour.
- Generated `dist` output ready for both ESM and type-safe imports in frontend and services.
- Docs covering token inheritance, semantic naming, and how to request additions.

## Risks & Mitigations
- **Overdesign risk:** Time-box the initial taxonomy review to existing UI needs; capture stretch tokens as follow-up issues.
- **Adoption risk:** Pair with frontend owners to review proposed token names before locking the API.
