# Define module SDK capability contracts

## Context
- Examples currently import internal packages like `@apphub/filestore-client` and `@apphub/event-bus/proxy`, which breaks the goal of shipping modules that can load without the full core tree.
- Each job/service reimplements default parameter parsing and fetch wrappers for filestore, metastore, and timestore access, leading to drift and repetitive code.
- We agreed on a hybrid approach where the SDK offers thin, well-typed capability shims while allowing modules to opt out and bring their own clients when needed.

## Impact
- Module authors cannot rely on a stable runtime contract today, so every example duplicates bootstrap logic and utility code.
- Changes to core service APIs require refactoring every example job individually, increasing the risk of regressions.
- Without a shared SDK, we cannot publish modules independently or support third-party development that depends only on the runtime contracts.

## Proposed direction
1. Create a new workspace package `packages/module-sdk` that exports the core module runtime types (`defineModule`, `createJobHandler`, `ModuleContext`, etc.).
2. Implement lightweight capability shims inside the SDK for filestore, metastore, timestore, event bus, and core HTTP access. Keep the surface area focused on the minimum required operations (e.g. `ensureDirectory`, `uploadFile`, `upsertRecord`).
3. Allow modules to override any capability by providing their own implementation when registering a target. Document the escape hatch so advanced scenarios can bring bespoke clients.
4. Provide shared utilities for configuration and secret access (e.g. `context.settings`, `context.secrets`), replacing the environment-variable parsing currently scattered across jobs.
5. Add unit tests and TypeScript type tests that cover capability injection, custom overrides, and error propagation, ensuring the SDK works without other repo packages installed.

## Acceptance criteria
- `packages/module-sdk` builds independently and publishes type definitions plus runtime code.
- Capability shims expose typed methods for filestore, metastore, timestore, event bus, and core HTTP, with optional overrides per target.
- Module handlers access configuration via the provided context instead of reading environment variables directly.
- Documentation in the SDK README covers default shims, custom capability injection, and versioning expectations.
- CI runs the new SDK tests and type checks.
