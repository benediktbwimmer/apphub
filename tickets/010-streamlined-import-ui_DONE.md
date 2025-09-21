# Ticket 010: Consolidate Import UX and Plan Job Imports

## Summary
Define the UX and technical approach for consolidating the import surface into a single tab with sub-tabs for service manifests, apps, and jobs, while establishing a smart import workflow for new job bundles.

## Problem Statement
The current UI splits imports across multiple entry points, creating redundant flows and making it harder to introduce the new job artifacts. We need a unified operator experience that supports all import types, clearly guides users through validation, and scales to the upcoming job bundle ecosystem.

## Scope & Requirements
- Design a primary "Import" area in the frontend with nested tabs for:
  - **Service Manifests**: existing YAML/JSON manifest ingestion.
  - **Apps**: repo/app registrations and metadata sync.
  - **Jobs**: new job definition bundles with version awareness.
- Audit existing routes/components to map out what needs to be merged into the consolidated import tab.
- Define UX copy, form layouts, and success/error handling patterns shared across tabs (e.g., toast messaging, inline validation).
- Capture API needs for the jobs import tab, including bundle upload, metadata validation, and dry-run previews.
- Document backend gaps (missing endpoints, schema validation, eventing) that must exist before the UI can ship.

## Research & Exploration
- Evaluate whether the jobs tab should accept signed bundle archives (tar/zip) or registry references (`slug@version`) and outline validation steps for each path.
- Investigate reuse of the existing manifest validation pipeline for jobs (schema validation, dependency resolution) versus introducing a new validator.
- Determine how to surface parameter schema previews and compatibility checks (e.g., ensuring required runtime capabilities are present) before saving the job definition.
- Map telemetry/hooks needed to notify operators when an import requires manual intervention or additional approvals.
- Identify opportunities to cache recent imports or draft submissions so operators can resume interrupted flows.

## Acceptance Criteria
- UX specification (wireframes or written flow) describing the single import page and its sub-tabs, including empty states and error cases.
- Checklist of frontend components to build or refactor, with ownership and estimates.
- API contract draft for job import operations covering request/response payloads and validation errors.
- Risk assessment for job imports (e.g., bundle authenticity, version conflicts) with proposed mitigations.
- Alignment notes with platform stakeholders confirming the plan covers upcoming job rollout milestones.

## Dependencies
- Completion of job registry/runtime foundations (tickets 006–009) to provide bundle metadata and execution context.
- Any outstanding design system updates required to support tabbed navigation and rich form validation states.

## Open Questions
- Do we need environment-specific import behavior (e.g., sandbox vs. production) that changes validation rules?
- Should job imports trigger automatic sandbox executions for smoke testing, and if so how are results surfaced?
- How do we handle bundle de-duplication and version upgrades when a job already exists in the catalog?

## Testing Notes
- Future implementation tasks should include automated UI tests covering the tab navigation and form validation flows once components are built.
