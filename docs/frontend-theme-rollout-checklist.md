# Frontend Theme Rollout Checklist

Ticket 604 lifts shared UI surfaces onto semantic tokens. Follow this checklist when validating new or existing flows against additional themes.

## Pre-rollout
- [ ] Confirm updated ESLint rules run locally (`npm run lint --workspace @apphub/frontend`) and address any `semantic-tokens/no-raw-color-classnames` failures.
- [ ] Ensure Storybook or design review sign-off for Navbar, modal, form interactions, toasts, and buttons across light, dark, branded, and high-contrast themes.
- [ ] Capture Playwright or Vitest snapshots for representative flows (`ThemeTokens.test.tsx` and `WorkflowGraphCanvas.test.tsx` cover baseline assertions).

## QA Validation
- [ ] Switch ThemeProvider preferences (system, dark, tenant overrides) and verify Monaco, workflow graph, navbar, dialogs, and notifications respect semantic colors without contrast regressions.
- [ ] Spot-check headings, buttons, and toasts to ensure `text-scale-*` utilities reflect tenant typography overrides (font size/line-height adjustments).
- [ ] Exercise keyboard focus states on primary navigation, buttons, and modals to confirm border/ring tokens are applied.
- [ ] Trigger success, warning, and error toasts to verify status palettes and text contrast.

## Deployment
- [ ] Include screenshots of light/dark/high-contrast themes in the release notes shared with customer teams.
- [ ] Communicate the new linting rule and available utility classes to feature teams; reference `docs/frontend-theme-integrations.md` for integration details.
- [ ] Monitor telemetry or support channels for theme regression reports during rollout; be ready to toggle back to the previous bundle if high-severity issues surface.
- [ ] File follow-up tickets for any modules still using raw Tailwind color utilities; annotate ownership and planned iteration.
