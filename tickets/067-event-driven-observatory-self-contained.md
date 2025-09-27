# Ticket 067: Make Event-Driven Observatory Example Fully Self-Contained

## Problem Statement
The new environmental observatory **event-driven** example requires several manual follow-up steps before it is usable in the Product UI. Operators must run CLI scripts to seed event triggers, hand-create schedules for the data generator workflow, and manually tweak the import wizard flow because the example isn’t surfaced in `EXAMPLE_SCENARIOS`. This leaves the experience inconsistent with other turnkey examples and makes it hard to demo end-to-end event-triggered workflows without additional documentation.

## Goals
- Ship the example so that importing it from the UI automatically installs all required jobs, workflows, triggers, and schedules.
- Introduce a ready-to-use schedule for `observatory-minute-data-generator` so fresh data is generated without manual runs.
- Embed trigger definitions (filestore upload + timestore partition) as part of the example assets and ensure the import pipeline applies them.
- Update `packages/examples-registry/src/scenarios.ts` (and any derivative registries) to list the new event-driven scenario, replacing/augmenting the legacy observatory scenario references.
- Align the import wizard so it highlights the event-driven scenario, surfaces the required setup steps, and reflects new “auto-triggered” metadata.

## Non-Goals
- Rebuilding the entire import workspace UX from scratch.
- Overhauling unrelated examples or non-observatory scenarios.
- Implementing multi-tenant scheduling policies (stick to single-tenant dev experience for now).

## Implementation Sketch
1. **Example Assets**
   - Update the observatory workflows to include baked-in trigger definitions (JSON inline) and add a cron/interval schedule for the generator workflow.
   - Extend example setup scripts to become idempotent, but ensure the default import path doesn’t require them.
2. **Registry Updates**
   - Refresh `packages/examples-registry/src/scenarios.ts` + `jobs.ts`/`workflows.ts` mapping so the event-driven observatory scenario is selectable and accurately describes dependencies (filestore, timestore, metastore).
3. **Import Wizard UX**
   - Adjust `apps/frontend` import flows (e.g., `ExampleScenarioPicker`, `useImportWizardController`, supporting copy) to surface the new scenario, mention that triggers + schedules will be created, and expose any new parameters.
4. **Validation**
   - Run the full import E2E (`examples/tests/catalog/environmentalObservatoryIngest.e2e.ts`) without manual trigger scripts to confirm success.
   - Capture documentation/screenshots showing the “one-click” import path.

## Acceptance Criteria
- Importing the event-driven observatory scenario from the UI yields a working setup: generator schedule present, triggers registered, workflows runnable.
- No manual CLI steps are required post-import; the example is demo-ready out of the box.
- `scenarios.ts` (and registry exports) list the correct scenario entries pointing to `environmental-observatory-event-driven` assets.
- The import wizard copy and dependencies reflect the event-driven architecture and pass existing lint/test checks.
