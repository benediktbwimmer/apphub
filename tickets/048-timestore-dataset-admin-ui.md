# Ticket 048: Timestore Dataset Admin UI

## Problem Statement
The timestore frontend lists datasets and shows manifests, but administrators cannot create or edit datasets from the UI. Without a management surface, they must fall back to API calls or ingestion hacks to change names, statuses, storage targets, or IAM metadata.

## Goals
- Introduce UI workflows to create new datasets, edit metadata, and archive/reactivate existing datasets using the forthcoming admin CRUD API.
- Provide form validation, optimistic updates, and toast feedback for success/failure states.
- Respect scope checks (`timestore:admin`) by gating controls and displaying helpful messaging when scopes are missing.

## Non-Goals
- Building wizard-driven ingestion or schema-edit experiences; focus on dataset metadata management.
- Exposing low-level JSON editors for metadata—favor structured fields surfaced by the API.

## Implementation Sketch
1. Add a "Create dataset" action to `TimestoreDatasetsPage` that opens a modal or side panel bound to the new admin endpoint.
2. Embed edit controls in the dataset detail pane for name, description, status, default storage target, and IAM scopes, with diff-aware submit buttons.
3. Integrate the new shared request/response schemas, wiring optimistic UI updates and error handling (including validation messages returned by the API).
4. Update polling/cache logic to reconcile list/detail state after mutations without reloading the entire page.
5. Write component tests covering create/update flows, scope guard behavior, and error messaging.

## Deliverables
- UI components enabling admin users to create and edit datasets from the timestore console.
- Robust form handling with validation, optimistic updates, and clear error states.
- Test coverage demonstrating the controls respect scope requirements and sync list/detail state after changes.
