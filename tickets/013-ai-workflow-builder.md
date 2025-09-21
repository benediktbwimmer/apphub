# Ticket 013: AI-Assisted Job & Workflow Builder UI

## Summary
Design and ship a workflow-creation experience in the AppHub UI that leverages the Codex CLI to draft job or workflow definitions. The interface must live in the operator console, guiding users from natural-language requests to schema-compliant definitions. The project also includes producing and publishing any supporting job bundle required to execute AI-driven steps from within workflows.

## Problem Statement
Operators currently hand-author JSON payloads to register jobs or workflows, which is error-prone and inaccessible to non-experts. Prior effort focused on CLI automation, but the primary surface for operators is the web UI. We need an in-app builder that collects the relevant catalog metadata, engages Codex to suggest a definition, validates the output against platform constraints, and allows the operator to accept or revise the proposal. Additionally, the AI-driven steps referenced by the generated workflows must be backed by an executable job bundle so the catalog can orchestrate them at runtime.

## Goals & Scope
- Extend the frontend workflow area with an "AI Builder" panel accessible to scoped operators (reuse navigation from Ticket 011 when available).
- Enable operators to describe their desired automation in plain language (workflow vs. job, triggers, services involved, constraints) within the UI.
- Fetch catalog metadata (jobs, services with capabilities/OpenAPI hints, existing workflows) from the API and summarize it for the Codex prompt.
- Invoke the configured Codex CLI from the frontend (via secure backend proxy if needed) and receive candidate job/workflow definitions.
- Run validation in the browser using the same schemas as the API (reuse zod contracts) and perform DAG checks client-side; display actionable error feedback inline.
- Present a review surface showing the generated JSON, highlighted validation status, and an editable form so operators can make adjustments before submission.
- On approval, persist the definition through the catalog API (`POST /jobs` or `POST /workflows`) with the operator’s token, surfacing success/failure toasts and audit logs.
- Package and publish the supporting AI job bundle (e.g., an `ai-orchestrator` bundle that wraps model invocation) so generated workflows have a runnable job step; wire it into the builder presets.
- Record user sentiment (accepted/rejected/edited) in telemetry suitable for future prompt tuning (local analytics for now).

## Non-Goals
- Replacing the existing manual workflow editor; the AI builder is additive.
- Supporting automated multi-run tuning or continuous improvement loops in this iteration.
- Building a generalized prompt management system—configuration is limited to environment variables and bundled defaults.

## Acceptance Criteria
- UI exposes an AI builder entry point that is only visible to operators with `workflows:write` or `jobs:write` scopes (validated via `/auth/identity`).
- Builder captures the operator request, fetched context, and Codex response; validation errors are displayed without leaving the view.
- Generated definitions reference real job/service slugs and pass local schema + DAG validation before the submission button enables.
- Submitting the approved draft successfully calls the catalog API and updates the workflow list without a page refresh; errors are clearly surfaced.
- Supporting AI job bundle is packaged (using existing bundle tooling), published to the local registry, and registered in the catalog; the builder can insert the bundle’s slug into generated workflows.
- Frontend logs (console or structured telemetry) note whether the operator accepted, edited, or rejected the AI suggestion.

## Implementation Notes
- Frontend should reuse the zod schemas declared in `services/catalog/src/server.ts` (export shared schema package if necessary) for consistent validation.
- Consider a thin backend proxy endpoint for Codex requests to avoid exposing API keys in the browser; ensure rate limiting and error handling are in place.
- Prompt engineering should stay within token limits: include concise summaries of services/jobs (slug, purpose, parameters) rather than raw OpenAPI documents.
- The new job bundle should encapsulate Codex invocation logic (API call, secret resolution) and expose a simple parameters schema so workflows can re-use it.
- Ensure secrets needed for the AI bundle (e.g., provider tokens) are sourced from the existing secret store and audited via `secret.resolve` events.
- Provide affordances for manual editing (JSON editor with syntax highlighting or structured form) before making API calls, to maintain operator control.

## Open Questions
- Should Codex responses be cached server-side to allow replays without incurring additional inference cost?
- How do we store prompt/response transcripts for audit without leaking sensitive metadata (encrypted storage vs. opt-in download)?
- Do we need multi-turn refinement (chat-style) in this phase, or is a single-shot generation with manual edits sufficient? -> multi-turn refinement
- What UX should surface the supporting job bundle version and indicate when it needs updates or republishing?

## Dependencies
- Workflow builder navigation and permissions groundwork from Ticket 011.
- Stable operator token scopes (`jobs:write`, `workflows:write`) and catalog endpoints (`/jobs`, `/services`, `/workflows`).
- Access to Codex/AI provider credentials (secret store entries, environment variables).
- Job bundle packaging pipeline (CLI + registry service) to publish the new AI bundle.

## Testing Notes
- Frontend unit and integration tests covering: metadata fetching, prompt construction, validation workflows, submission happy path, and error states.
- E2E smoke test that generates a sample workflow, validates locally, submits to the API, and confirms it appears in the workflow list.
- Job bundle tests (CLI or harness) ensuring the Codex invocation handler resolves secrets, handles errors, and returns structured results compatible with the orchestrator.
- Manual QA scenario: operator drafts a workflow that calls the new AI bundle to summarize repository metadata, edits the output, and successfully registers it.

## Deliverables
- Updated frontend code introducing the AI builder UI, validation hooks, and submission flow.
- Documented prompt format, configuration instructions, and operator guidance added to `docs/`.
- Published AI job bundle artifact (tarball + manifest) and migration/runbook updates explaining how to deploy it per environment.
- Telemetry or log artifact summarizing AI-assisted builder usage metrics (accept/reject/edit counts) for future tuning.
