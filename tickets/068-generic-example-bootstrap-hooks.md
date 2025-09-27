# Ticket 068: Generic Bootstrap Hooks for Example Modules

## Problem Statement
The catalog currently wires environment defaults and filestore bootstrapping for
the observatory example via hard-coded logic inside runtime routes. Even with
the recent refactor into `@apphub/examples-registry`, the application still
depends on example-specific knowledge (e.g. workflow slugs, config layouts).
This prevents third parties from shipping their own example modules that may
require custom provisioning steps (database seeds, filesystem prep, remote API
stubs, etc.). We need a declarative and extensible mechanism so modules can
declare bootstrap requirements that the host application executes without
needing to understand module-specific details.

## Goals
- Allow service manifest imports to discover optional "bootstrap hooks" defined
  by the module and execute them prior to applying manifests.
- Support common tasks such as ensuring filesystem directories exist, creating
  filestore backends, seeding databases, and adjusting workflow defaults using
  configuration provided by the module.
- Ensure hooks run idempotently and surface structured results (success,
  warnings, recoverable errors).
- Keep the catalog/API logic generic: no hard-coded knowledge of observatory or
  any other example.
- Maintain security boundaries—hooks must run in a sandboxed executor that
  respects deployment policies (e.g. disabled in production or requires manual
  approval).

## Non-Goals
- Replacing the existing example registry. We only extend it with metadata/hooks
  to drive bootstrap automation.
- Implementing long-running background workflows; hooks should be quick,
  blocking steps. Larger migrations can enqueue dedicated jobs via existing
  APIs.
- Designing a full plugin system for arbitrary user code; hooks will rely on a
  constrained catalog-provided primitive set.

## Proposed Approach
1. **Module Metadata Extension**
   - Extend example modules to ship a `bootstrap.json` (or embed directives in
     `service-config.json`) describing required actions.
   - Actions include `ensureDirectories`, `ensureFilestoreBackend`,
     `applyWorkflowDefaults`, `seedDatabase`, `setEnvDefaults`, etc.
   - Each action references placeholders/variables already surfaced by the
     manifest preview so operators can override paths/tokens.

2. **Generic Bootstrap Executor**
   - Introduce a bootstrap runner within the catalog that reads the module’s
     action list and dispatches corresponding helpers (filesystem, filestore,
     Postgres migrations, HTTP calls).
   - Actions execute idempotently; failures abort the import and return
     actionable error messages.
   - Allow disabling bootstrap entirely via `APPHUB_DISABLE_MODULE_BOOTSTRAP`.

3. **Workflow Default Injection**
   - Convert the current observatory-specific default mutation into a generic
     `applyWorkflowDefaults` action that references workflow slugs and key/value
     overrides. The executor loads the workflow definition payload and applies
     overrides prior to creation.

4. **Filestore Backend Provisioner**
   - Ship a reusable action that ensures a filestore backend exists (local path
     or S3) using configuration pulled from the module’s variables. This
     replaces the current bespoke observatory helper.

5. **Documentation & Tooling**
   - Update example authoring docs to explain how to declare bootstrap actions
     and provide linting/validation in `examples-registry` to verify action
     schemas.

## Acceptance Criteria
- Service config imports process bootstrap action lists without any
  observatory-specific code inside catalog routes.
- Observability example uses the new action schema to provision the filestore
  backend and workflow defaults.
- Catalog gracefully handles unknown/unsupported actions (logs + fail with
  helpful error).
- Bootstrap runner unit tests cover each action type; an end-to-end test proves
  the observatory import completes successfully using the new generic path.

