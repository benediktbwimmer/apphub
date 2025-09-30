# Ticket 702: Establish Theme Visual Regression Coverage

## Problem
Semantic tokens now drive core surfaces, but we lack automated visual checks across light, dark, branded, and high-contrast themes. Manual QA alone risks regressions when tokens or components evolve.

## Proposal
- Stand up Storybook or Playwright snapshot suites targeting representative flows (navbar, modals, forms, tables, workflow graphs) under each supported theme.
- Integrate snapshots into CI with lightweight diff review tooling (Chromatic/Storybook, Playwright trace, or Percy) and document the acceptance threshold.
- Capture baseline screenshots for tenants, and alert design/release engineering when pixel diffs exceed tolerance.

## Deliverables
- Automated snapshot/test configuration committed under `apps/frontend/tests/` (or Storybook equivalent).
- Baseline artifacts for light/dark/high-contrast variants stored or published for review.
- Runbook outlining how to update baselines when token changes are intentional.

## Risks & Mitigations
- **Flaky diffs:** Use deterministic data fixtures and disable animations/transitions to stabilise snapshots.
- **Pipeline cost:** Scope initial coverage to high-value surfaces, expanding once tooling proves stable.
