# Ticket 604: Migrate Frontend Surfaces and Validate Theme Coverage

## Problem
Even after foundational work, most feature modules still embed raw Tailwind color utilities. Without a systematic sweep we risk a fragmented theming story and inconsistent accessibility outcomes.

## Proposal
- Audit component directories (`apps/frontend/src/**`) to replace hard-coded color classes with semantic helpers or tokens, prioritising shared chrome (Navbar, buttons, modals) then feature pages.
- Add visual regression coverage (Storybook stories or Playwright snapshots) exercising light, dark, branded, and high-contrast themes for representative flows.
- Document manual validation steps and capture any sections that remain legacy as follow-up tasks.

## Deliverables
- Updated components using semantic theming primitives with lint rules preventing reintroduction of raw color utilities.
- Regression artifacts proving theme parity across key screens, checked into `tests/` or CI pipeline.
- Rollout checklist in `docs/` covering verification, fallback plan, and communication to customer teams.

## Risks & Mitigations
- **Scope creep:** Track uncovered modules separately and file follow-up tickets if they exceed the initial sweep capacity.
- **Automation gaps:** Pair automated screenshots with manual QA sign-off for accessibility features (focus rings, status badges).
