# Ticket 066: Extend Workflow UI for Event Trigger Management

## Problem Statement
With event-driven scheduling in place, operators need a visual interface inside the existing frontend to inspect events, configure triggers, and understand workflow activation status. The current UI only surfaces asset-based schedules, leaving event triggers invisible and increasing reliance on CLI/API calls.

## Goals
- Add a workflow detail tab that lists event triggers, their predicates, throttle settings, and recent delivery outcomes.
- Provide forms/modals to create, edit, enable/disable, and delete triggers with inline validation for JSONPath predicates, parameter templates, and throttling fields.
- Surface event samples from `workflow_events` to help operators test predicates (e.g., select an event and preview parameter rendering).
- Visualize trigger health indicators (last match time, throttled state, DLQ count) and link to operations docs/runbooks.

## Non-Goals
- Designing a cross-service event explorer beyond workflow-contextual views.
- Supporting arbitrary code editors or advanced JSON authoring beyond structured forms + raw JSON fallback.
- Implementing tenant-facing trigger management (keep scoped to internal admin users).

## Implementation Sketch
1. Update `apps/frontend` workflow routes to include a new “Event Triggers” tab, fetching triggers via the API from ticket 065 and displaying summarized cards/table rows with status badges.
2. Build form components backed by shared validation utilities (Zod schemas) mirroring server-side rules; include preview panels for parameter templates using sample events.
3. Integrate delivery history chart/list (recent matches, throttled counts) using existing chart components or timeline lists.
4. Add an “Event Samples” drawer that queries the admin events endpoint (ticket 060) with filters pre-populated from trigger definitions.
5. Ensure role checks gate the UI to authorized users, and add Cypress or Playwright tests covering create/edit/disable flows and validation errors.
6. Update frontend documentation and onboarding guides to highlight the new tab, including screenshots.

## Acceptance Criteria
- Authorized users can fully manage event triggers via the UI, including creating, updating, disabling, and deleting entries with real-time validation feedback.
- Workflow detail pages display trigger health summaries and link to relevant runbooks when throttles or DLQ counts are non-zero.
- Event sample preview helps users confirm predicates and parameter rendering before saving.
- Automated frontend tests cover critical flows and documentation reflects the new UI functionality.
