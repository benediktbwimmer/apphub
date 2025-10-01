# Port environmental observatory example to module runtime

## Context
- The observatory example currently lives under `examples/environmental-observatory-event-driven/` with bespoke job/service entry points and shared utilities.
- Jobs parse dozens of parameters, import internal clients, and perform bootstrap work independently, creating tight coupling with the core monorepo.
- We need the observatory scenario to serve as the reference implementation for the new module system, demonstrating runtime-loaded jobs, services, and workflows.

## Impact
- Maintaining the observatory example is expensive: defaults diverge, environment handling is inconsistent, and refactors require touching every job.
- External module authors cannot learn the new patterns because the flagship example still reflects the legacy layout.
- Shipping runtime-loaded modules will be blocked until at least one end-to-end scenario adopts the new architecture.

## Proposed direction
1. Create `modules/environmental-observatory/` with a `module.ts` definition that registers jobs, services, workflows, and resources using the SDK from ticket 001.
2. Move existing jobs/services into the module, rewriting their entry points to use `createJobHandler`/`createService` so they receive injected capabilities instead of parsing URLs/tokens.
3. Consolidate shared logic under `modules/environmental-observatory/src/runtime/` and expose it via the module's runtime barrel file; remove the ad-hoc `shared/` directory.
4. Define per-target configuration schemas alongside the module definition, supplying defaults for filestore/metastore/timestore parameters and supporting overrides via `context.settings`.
5. Delete or archive obsolete files in `examples/environmental-observatory-event-driven/` once parity is verified, keeping artifacts such as documentation or datasets only if still relevant.

## Acceptance criteria
- `modules/environmental-observatory/module.ts` describes all jobs/services/workflows and compiles via the module SDK.
- Every observatory job/service imports capabilities from the injected context rather than directly from `@apphub/*` packages.
- Shared utilities live under the new runtime folder with clear exports; no remaining imports from `examples/environmental-observatory-event-driven/shared` exist.
- Example builds and tests execute through the module entry point, demonstrating the new architecture end-to-end.
- Legacy example directories are removed or replaced with pointers to the module implementation.
