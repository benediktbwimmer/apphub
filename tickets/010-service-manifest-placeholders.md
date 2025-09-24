# Ticket 010: Parameterizable Service Manifest Imports

## Problem Statement
The environmental observatory example (and future manifests) need interactive configuration when imported. Today a manifest encodes paths/tokens verbatim, which makes `Load all examples` fragile and forces users to edit JSON by hand. We want to support placeholder variables inside manifest files so the catalog prompts for values at import time (UI/API/CLI) and resolves them before applying the manifest.

## Goals
- Allow service manifest JSON to declare templated values (e.g. `${FILE_WATCH_ROOT}`) with optional metadata (description, default).
- Surface required placeholders in the `Import service manifest` UI so the operator can supply values before submission.
- Expose the placeholders via the `/service-networks/import` API so non-interactive imports can provide a `variables` map.
- Resolve placeholders on the server (service-config loader + registry) consistently for routes that load manifests from disk/env.
- Leave manifests that do not use placeholders untouched (backwards compatible).

## Non-Goals
- No support for templating arbitrary JSON logic (just simple value substitution).
- No change to job/workflow import flows in this ticket (they may follow the pattern later).

## Implementation Sketch
1. **Placeholder Syntax & Schema**
   - Decide on syntax (`${VAR}`) and optional inline metadata (e.g. object form `{ "$var": { "name": "FILE_WATCH_ROOT", "default": "...", "description": "..." } }`).
   - Extend `manifestEnvVarSchema` / related schemas to accept placeholder objects.

2. **Server-Side Resolution**
   - Update `serviceConfigLoader` to detect placeholders while parsing manifests/configs.
   - When placeholders remain unresolved, expose them to the caller instead of applying changes immediately.
   - Update `/service-networks/import` to accept `variables` payload; apply substitutions; return validation errors if required variables missing.

3. **UI Support**
   - Extend `useImportServiceManifest` + `ServiceManifestsTab` to handle the new response: when previewing an import, show generated form fields for each placeholder (type text with defaults/help text).
   - Persist entered values across retries and pass them with the import request.

4. **Example Update**
   - Convert `examples/environmental-observatory/service-manifests/service-manifest.json` to use placeholders for inbox/staging/warehouse/token.
   - Update documentation to guide operators on how prompts appear during import.

5. **Testing & Validation**
   - Add unit tests for placeholder resolution (server) and integration tests for successful/failed imports with variables.
   - Add Cypress/Playwright coverage (if existing patterns) or document manual testing steps.

## Open Questions
- Should placeholders support simple type hints (string/path/secret)?
- How do we handle placeholders in manifests loaded automatically on startup (no UI)? Possibly require env var resolution or skip until provided.

## Dependencies
- Existing service manifest loader (`serviceConfigLoader`), import API, and frontend importer.

## Estimated Effort
- Backend: 2-3 days (schema tweaks, loader changes, API update, tests).
- Frontend: 1-2 days (UI prompts, state handling).
- Documentation/example updates: 0.5 day.

## Deliverables
- Updated schema and loader with placeholder resolution.
- API support for supplying variables when importing manifests.
- UI form prompting for placeholder values.
- Updated observatory manifest + docs.
