# Ticket 011: Implement Workflow Creation and Editing in UI

## Summary
Deliver the end-to-end UX that lets operators create new workflows and edit existing ones from the web application, wiring the UI into the catalog services and persisting updates.

## Problem Statement
Workflows currently require manual authoring or API calls, which blocks non-technical operators from orchestrating multi-step jobs. Without a guided UI, workflow changes are error-prone, lack validation, and provide no feedback about execution readiness.

## Scope & Requirements
- Add a "Workflows" area in the frontend navigation that lists existing workflows with search and basic metadata.
- Provide a "Create workflow" flow with:
  - Form inputs for workflow name, description, tags, and owner/contact.
  - Builder interface to add, order, and configure steps referencing catalog jobs.
  - Inline validation for required fields, duplicate step detection, and incompatible parameter types.
  - Draft autosave so operators can pause mid-creation.
- Implement an "Edit workflow" mode that loads an existing workflow, shows unsaved changes, and supports version notes.
- Surface preview of the resulting workflow JSON/spec before submission, highlighting diffs on edit.
- Integrate with catalog API endpoints for reading, creating, updating, and validating workflows; handle optimistic concurrency/versioning semantics.
- Display success and error states (toasts, inline errors) with actionable remediation guidance.
- Ensure RBAC/permissions are enforced in the UI, hiding create/edit actions for unauthorized users.

## Research & Exploration
- Audit current catalog API capabilities for workflows: confirm payload schema, validation endpoints, and concurrency controls.
- Identify design system components (forms, lists, drag-and-drop, diff viewer) that can be reused versus needing new primitives.
- Explore step configuration UX patterns (drawer vs. modal) to balance readability with complex parameter editing.
- Determine strategy for fetching job metadata (inputs, outputs, runtime requirements) and caching it client-side for builder interactions.
- Evaluate whether workflow versioning should be explicit (e.g., semantic versions) or implicit timestamps and how the UI surfaces history.

## Acceptance Criteria
- Workflow list page showing existing workflows with ability to open for editing.
- Create workflow experience that validates inputs, allows step configuration, and persists to backend.
- Edit workflow experience that loads existing data, captures changes, and prevents overwriting newer revisions.
- API contract documentation or updated types for workflow create/update requests and responses.
- Error handling matrix covering API failures, validation errors, and permission denials.
- Product documentation outlining operator journey and edge cases (e.g., missing job references).

## Dependencies
- Stable workflow schema and API endpoints in the catalog service that support create/update/read operations.
- Updated authorization rules defining which roles may create or edit workflows.
- Finalized design mocks for workflow builder interactions.

## Open Questions
- Should workflow drafts support collaboration or comments, and how would conflicts be resolved?
- Do we need to support cloning existing workflows as a starting point?
- How should the UI surface downstream impacts when editing a workflow already scheduled or in use?
- Are there guardrails needed for referencing jobs that are in beta or deprecated states?

## Testing Notes
- Implementation work should include integration tests for the workflow API adapter and UI-driven unit tests covering validation and step manipulation interactions.
- Plan end-to-end tests that cover creating a new workflow and editing an existing one, including error scenarios.
