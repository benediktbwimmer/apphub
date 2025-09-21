# Consolidated Import Workspace Plan

## Overview
The AppHub operator UI will consolidate all import functionality into a single "Import" workspace surfaced as a primary navigation tab. Inside the workspace, secondary tabs separate Service Manifests, Apps, and Jobs while maintaining consistent affordances for validation, feedback, and history. This plan captures the UX specification, component work, backend contracts, and rollout alignment required to ship the unified experience in support of the job bundle ecosystem.

## Current-State Audit
- **Entry points**
  - `ImportServiceManifest` is rendered when the global navigation selects the `import-manifest` tab, providing a dedicated service manifest form and success summary.
  - App registration lives under the `submit` tab (`SubmitApp` route) with its own layout, success state, and toast usage.
  - There is currently no UI for job bundle imports; operators rely on CLI tooling (`apphub jobs publish`) and backoffice ingestion.
- **Shared concerns**
  - The Navbar component already persists active tab selection; consolidating imports requires renaming the stored tab key and providing nested routing to avoid clobbering existing catalog/app navigation.
  - Form patterns lean on Tailwind utility classes for styling and inline validation messages. To reduce duplication, shared form scaffolding should move to `apps/frontend/src/components` (e.g., `FormSection`, `FormActions`, `FormFeedback`).

## Proposed Information Architecture
- **Primary navigation**: Replace the current `import-manifest` tab with a single `import` tab in `App.tsx`. Selecting it renders an `ImportWorkspace` shell containing secondary tabs.
- **Secondary tabs**:
  1. **Service Manifests** – existing functionality refactored into the shell. Acts as the default tab when arriving from global navigation.
  2. **Apps** – consolidates `SubmitApp` flow. Operators register repositories and sync metadata.
  3. **Jobs** – new surface for uploading or referencing job bundles.
- **Persistence**: Maintain the current `localStorage` persistence for the primary tab; the workspace itself should preserve the last selected secondary tab per user (e.g., `apphub-import-active-subtab`).
- **Shared feedback**: Introduce toast notifications for success/error using the existing notification system (extend `useToasts` if needed) while retaining inline validation for field-level issues. Success states should also display summarized results in the right-hand pane to keep parity with manifest imports.
- **Empty states**: Each tab shows a short description when no import has been attempted along with contextual links to docs (`docs/job-bundles.md` for jobs, service manifest reference for manifests, etc.).

## UX Specification by Tab
### Service Manifests
- Left column preserves the existing repository form but reuses shared form components.
- Right column summarizes results; add a "Re-run import" secondary action when `canReimport` is true to match future job behavior.
- Copy updates emphasize validation (“AppHub validates repository access and manifest schema before applying changes”).

### Apps
- Convert the `SubmitApp` flow into the tab layout. Steps:
  1. Repository URL + optional branch input.
  2. Metadata fields (name, description, categories).
  3. Optional webhook toggle for metadata sync.
- Provide inline validation and toast notifications identical to the Service Manifest tab. Show a summary card with the new app slug, detected integrations, and quick links to view in catalog.
- Support saving drafts (auto-populate fields from `localStorage`) to satisfy the caching requirement.

### Jobs
- **Source selection**: Radio group toggles between "Upload bundle archive" (accepts `.tar.gz` produced by CLI) and "Registry reference" (`slug@version`).
- **Bundle validation**: On submit, call the new API contract (see below) which returns validation results, manifest metadata, capability requirements, and dry-run preview details.
- **Preview pane**: Display manifest metadata (name, version, capabilities), parameter schema preview, and any compatibility warnings. Provide a "Confirm import" call-to-action that triggers a second POST to commit the job definition.
- **Error states**: Inline list of schema errors, capability mismatches, or authenticity failures. Offer guidance links to bundle troubleshooting docs.
- **Telemetry hook**: When errors occur, fire a `jobs_import_failed` event through the existing analytics provider with the error category for operations monitoring.

## Smart Import Workflow for Jobs
1. **Upload/Reference**: Operator selects source type and provides either an archive or `slug@version` reference.
2. **Integrity & authenticity**: Frontend uploads archives using multipart form data; backend verifies checksum and signature. Registry references trigger a metadata fetch to ensure the version exists and is trusted.
3. **Schema validation**: Backend reuses manifest JSON Schema (aligned with CLI) and returns structured validation errors. Response includes normalized manifest.
4. **Capability resolution**: Backend compares manifest `capabilities` with available runtime capabilities; returns warnings for optional gaps and errors for missing required ones.
5. **Dry-run planning**: Backend evaluates parameter schema to determine required inputs. If possible, runs a dry-run in sandbox mode; otherwise provides a simulated plan with steps to execute manually.
6. **Confirmation**: Operator reviews results and confirms. Backend persists job definition, associates bundle version, schedules optional smoke test run, and emits registry events.
7. **Post-import feedback**: UI presents toast + summary card with job slug, version, runtime, and links to execution history.

## Component & Implementation Checklist
- **Shell & navigation**
  - [ ] Create `ImportWorkspace` component with secondary tabs (likely using headless UI `Tab` or a custom segmented control).
  - [ ] Update `NavigationContext` and `Navbar` to map the `import` tab to the new workspace.
  - [ ] Migrate local storage persistence keys (`ACTIVE_TAB_STORAGE_KEY` -> include new value, add subtab key).
- **Shared form primitives**
  - [ ] Extract button, section, and feedback classes into reusable components under `src/components/form/`.
  - [ ] Introduce toast helper if none exists (or wire into global context).
- **Service Manifest tab**
  - [ ] Refactor `ImportServiceManifest` to use workspace layout and shared components.
  - [ ] Ensure re-import action surfaces as a secondary button.
- **Apps tab**
  - [ ] Move existing `SubmitApp` logic into `ImportApps` component that conforms to workspace contract (submit handler receives toast callbacks, summary data).
  - [ ] Add draft persistence using local storage hooks.
- **Jobs tab**
  - [ ] Build `ImportJobBundle` component with source toggle, file uploader, and manifest preview panel.
  - [ ] Implement stepper for validation -> confirmation -> success states.
  - [ ] Add analytics hook for failure/success events.
- **Routing & API hooks**
  - [ ] Extend API client utilities with job import methods (`useJobImportPreview`, `useConfirmJobImport`).
  - [ ] Update TypeScript types for new responses under `src/services`.

## API Contract Draft for Job Imports
### POST `/job-imports/preview`
- **Purpose**: Validate an uploaded bundle or registry reference without persisting.
- **Request (multipart when uploading)**:
  ```json
  {
    "source": "upload" | "registry",
    "archive": <file>,              // required when source=upload
    "reference": "slug@version",   // required when source=registry
    "notes": "optional operator notes"
  }
  ```
- **Response** (`200 OK`):
  ```json
  {
    "data": {
      "bundle": {
        "slug": "example-job",
        "version": "1.2.3",
        "description": "Summarises inputs",
        "capabilities": ["fs", "network"],
        "checksum": "sha256:...",
        "parameters": {
          "schema": { /* JSON Schema */ }
        }
      },
      "warnings": [
        { "code": "missing_optional_capability", "message": "Runtime lacks optional capability: gpu" }
      ],
      "errors": [],
      "dryRun": {
        "status": "skipped" | "succeeded" | "failed",
        "resultUrl": "https://...",
        "logs": "Base64 encoded tail" // optional
      }
    }
  }
  ```
- **Error Responses**:
  - `400` for schema or authenticity failures with `errors` array specifying fields.
  - `409` when bundle version already exists (surface as warning with suggested action).

### POST `/job-imports`
- **Purpose**: Persist a validated bundle and trigger downstream processes.
- **Request**:
  ```json
  {
    "bundle": {
      "source": "upload" | "registry",
      "reference": "slug@version",
      "checksum": "sha256:...",
      "dryRunId": "uuid",          // returned from preview when available
      "metadata": {
        "notes": "optional"
      }
    }
  }
  ```
- **Response** (`201 Created`):
  ```json
  {
    "data": {
      "job": {
        "id": "uuid",
        "slug": "example-job",
        "version": "1.2.3",
        "runtime": "node18",
        "capabilities": ["fs", "network"],
        "createdAt": "2024-03-10T12:00:00Z"
      },
      "nextSteps": {
        "sandboxRunId": "run_123", // present when automatic smoke test queued
        "monitoringUrl": "https://.../runs/run_123"
      }
    }
  }
  ```

## Backend Gaps & Dependencies
- Need storage for uploaded archives pending confirmation (temporary object storage bucket or Redis-backed cache) keyed by preview token.
- Implement signature verification leveraging bundle CLI output (`.sha256` + signing cert). Coordinate with security for key rotation.
- Introduce dry-run sandbox executor capable of loading bundle in isolated runtime with limited resources; return logs/results to API.
- Extend registry service to handle version conflicts, metadata updates, and event emission (`job_imported`, `job_import_failed`).
- Provide capability inventory endpoint (`GET /runtime/capabilities`) so UI can prefetch available capabilities for comparison.

## Risk Assessment & Mitigations
- **Bundle authenticity**: Risk of tampered archives. Mitigate via mandatory checksum + signature verification before preview succeeds.
- **Version conflicts**: Importing an existing version could break running jobs. Mitigate with explicit warnings, ability to overwrite only with elevated permissions, and guidance to increment version.
- **Capability mismatches**: Deploying bundles requiring unavailable runtime features leads to failures. Mitigate by blocking confirmation when required capabilities are missing and suggesting alternative runtimes.
- **Large uploads & timeouts**: Operators may import multi-MB bundles over slow links. Mitigate with resumable uploads or at least upload progress UI and server-side streaming validation.
- **Dry-run flakiness**: Sandbox execution may fail for environment-specific reasons. Mitigate with clear error messaging, ability to retry, and capturing logs for diagnostics.

## Alignment Notes
- **Platform Operations**: Reviewed with ops lead (Elena) who confirmed need for telemetry events and runbook updates once automatic smoke tests are available.
- **Security**: Shared API contract for signature verification; security team to provide signing certificate management guidelines before GA.
- **Job Platform**: Coordinated with job runtime owners to ensure capability inventory endpoint and sandbox runner align with milestones from tickets 006–009.
- **Design Systems**: UI/UX reviewed with design team to ensure tab styling matches system updates shipping in Q3.

