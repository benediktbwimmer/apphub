# Ticket 701: Enforce Semantic Token Linting Across Frontend Workspaces

## Problem
The custom ESLint rule preventing raw Tailwind colour usage currently guards only shared components. Feature directories can still reintroduce legacy classes, eroding the benefits of the token migration over time.

## Proposal
- Expand the `semantic-tokens/no-raw-color-classnames` rule coverage to the entire frontend workspace, adding targeted ignores only for generated code or vendor wrappers.
- Provide autofix codemods / ESLint suggestions where safe (e.g., simple class replacements) to speed adoption.
- Integrate the rule into CI + pre-commit tooling, ensuring contributors hit the guardrail before submitting PRs.

## Deliverables
- ESLint config updated to cover `apps/frontend/src/**/*` with documented exceptions.
- Developer guide explaining common replacements and how to request new semantic utilities when needed.
- CI pipeline evidence showing the rule runs (build log snippet or config update).

## Risks & Mitigations
- **Noise from legacy code:** Stage enforcement per directory (catalog → events → metastore, etc.) while tracking remaining TODOs, so teams aren’t blocked by massive initial failures.
- **False positives:** For dynamic classnames or third-party integrations, document escape hatches (CSS variables, `/* eslint-disable-next-line */`) and file follow-up issues to build proper utilities.
