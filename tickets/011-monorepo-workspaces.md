# Ticket 011: Unify the Monorepo with npm Workspaces & Shared Tooling

## Problem Statement
The repo behaves like a monorepo but lacks a formal workspace definition. Each package (`services/catalog`, `apps/frontend`, `apps/cli`, shared helpers) manages dependencies, scripts, and TypeScript settings in isolation. Cross-project imports rely on relative paths (e.g. `../../../../../services/catalog/...`) and ad-hoc `shared/` modules with no package metadata. This fragmentation makes dependency upgrades brittle, complicates TypeScript path resolution, slows installs, and blocks us from publishing internal libraries. We need a cohesive workspace setup that treats services, apps, and shared utilities as first-class packages with consistent tooling.

## Goals
- Adopt npm workspaces (or pnpm if we decide during implementation) at the repo root so installs, scripts, and lockfiles are managed centrally.
- Promote shared code (e.g. `shared/`, future example registry) into named packages under a `packages/` directory with proper `package.json`, type exports, and build steps.
- Standardize TypeScript configuration using project references and a common `tsconfig.base.json`, wiring path aliases like `@apphub/catalog/*` and `@apphub/frontend/*`.
- Provide top-level scripts (`npm run lint`, `npm run test`, etc.) that delegate to package-specific scripts via workspaces tooling.
- Update CI, docs, and developer onboarding to match the new workflow (single install, workspace-aware scripts).

## Non-Goals
- Migrating to a different package manager is optional; we simply need a concrete recommendation in the design doc before implementation. (If pnpm is chosen, migration is in-scope.)
- Container build changes for production images are out of scope unless they break due to the new structure.
- No immediate refactors to application code beyond fixing import paths and tsconfig.

## Implementation Sketch
1. **Workspace Definition**
   - Introduce `package.json` `workspaces` field (or `pnpm-workspace.yaml`) covering `apps/*`, `services/*`, and a new `packages/*` directory.
   - Decide on npm vs. pnpm and document the rationale; ensure tooling (e.g. `concurrently`) still works.

2. **Shared Configuration**
   - Extract `tsconfig.base.json` at root with shared compiler options; update package-level configs to extend it.
   - Configure path aliases (via `paths` in TypeScript and corresponding Node/Vite alias config) to eliminate excessive relative imports.

3. **Package Promotion**
   - Move `shared/` to `packages/shared` with a dedicated `package.json`, expose exports, and adjust imports accordingly.
   - Prepare placeholders for future packages (e.g. `packages/examples`) so we have an obvious home for cross-cutting code.

4. **Scripts & Tooling**
   - Replace `cd package && npm run ...` scripts with workspace-aware commands (`npm run --workspace services/catalog dev`).
   - Add root-level commands for lint, build, and tests that run across workspaces (possibly using `npm run lint --workspaces --if-present`).

5. **Documentation & CI**
   - Update `README.md`, `docs/architecture.md`, and onboarding docs to describe the new workflow.
   - Adjust CI pipelines to run installs/tests using workspaces.

6. **Validation**
   - Ensure `npm install` (or `pnpm install`) succeeds from a clean checkout and that dev commands still run.
   - Spot-check TypeScript builds in catalog/api/frontend to verify alias resolution works end-to-end.

## Deliverables
- Root workspace configuration with consistent lockfile.
- Shared TypeScript base config and updated package configs.
- Promoted `packages/shared` module consumed by services/apps with new import aliases.
- Updated scripts, docs, and CI configuration reflecting the workspace workflow.
