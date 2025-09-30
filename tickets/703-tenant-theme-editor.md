# Ticket 703: Tenant Theme Editor & Runtime Overrides

## Problem
Theme switching supports predefined definitions, but tenants cannot customise palettes, typography, or spacing without code changes. Ops/design teams must ship new builds for simple tweaks, slowing experimentation and brand alignment.

## Proposal
- Build a Theme Settings UI (likely under `/settings/appearance`) that lets authorised users duplicate base themes, adjust semantic tokens (colours, typography scale), and preview changes live.
- Persist overrides via a backend API (e.g., metastore config) and ensure `ThemeProvider` hydrates runtime overrides on load.
- Provide guardrails: contrast warnings, change history, and reset-to-default actions to avoid inaccessible combinations.

## Deliverables
- UI allowing theme duplication, editing, preview, and activation per tenant.
- API/storage layer for theme definitions with validation and audit logging.
- Documentation/runbook covering rollout, permissions, and support workflows.

## Risks & Mitigations
- **Accessibility regressions:** Integrate colour-contrast checks before saving and offer presets meeting WCAG AA/AAA where applicable.
- **Config drift:** Version stored definitions and surface diffs to operations so changes can be monitored and rolled back.
