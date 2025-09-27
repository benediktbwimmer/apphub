# Ticket 076: Provide Auto-Materialize → Event Trigger Migration Helper

## Problem Statement
Many workflows rely on `autoMaterialize` policies for freshness management. As event-driven scheduling expands, teams need guidance and tooling to migrate (or complement) these policies with explicit event triggers. Manual conversion is error-prone, especially for partitioned assets and parameter defaults.

## Goals
- Build a CLI/API helper that inspects workflow definitions for `autoMaterialize` declarations and proposes equivalent event trigger specs.
- Highlight gaps where automated conversion is not possible (e.g., dynamic partition parameters) and provide actionable guidance.
- Document best practices for running both systems in parallel and criteria for deprecating asset-only scheduling when appropriate.

## Non-Goals
- Automatically deleting existing `autoMaterialize` policies; operators retain control over phased adoption.
- Replacing asset freshness timers; TTL/cadence policies remain managed by the materializer.

## Implementation Sketch
1. Add helper commands (e.g., `npm run workflow-triggers -- migrate-auto-materialize`) that load workflow definitions, analyze asset declarations, and emit trigger JSON/YAML drafts.
2. Map `onUpstreamUpdate` policies to event types (`asset.produced`/`asset.expired`) and derive parameter templates from `parameterDefaults` + stored partition hints.
3. Output migration reports summarizing proposed triggers, required manual edits, and parallel-run recommendations.
4. Optionally expose an API endpoint for the frontend to preview suggested triggers inside the workflow detail view.
5. Write tests covering workflows with various asset configurations (non-partitioned, partitioned, upstream dependencies) to ensure helper output is consistent.

## Acceptance Criteria
- Running the helper against existing examples produces draft trigger definitions with clear TODOs when automation cannot cover every case.
- Generated triggers pass schema validation (`eventTriggerValidation.ts`).
- Documentation describes workflow for exporting, reviewing, and applying the generated triggers alongside existing auto-materialize policies.
- Test coverage demonstrates helper behavior across representative workflows.
