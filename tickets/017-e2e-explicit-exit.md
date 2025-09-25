# 017: Ensure e2e test runners exit cleanly

## Background
Our long-running TypeScript e2e suites start embedded services (Postgres, Fastify, etc.). Most of them finish by awaiting cleanup helpers but never explicitly terminate the Node process. When sockets or timers linger (for example, stdout/stderr streams, pg pool handles), the process stays alive indefinitely and `npm run test:e2e` hangs.

## Proposal
- Create a small shared utility (e.g. `tests/helpers/runE2E.ts`) that wraps an async main function, captures thrown errors, awaits provided cleanup hooks, and then calls `process.exit` with the proper status code.
- Update all e2e entry points (`services/catalog/tests/*.e2e.ts`, `examples/tests/catalog/*.e2e.ts`, etc.) to use the helper instead of plain IIFEs. The helper should:
  - default exit code to `0`, switch to `1` on error;
  - log the error stack for visibility;
  - ensure cleanup runs even when the test throws;
  - optionally, log lingering handles for debugging when `APPHUB_E2E_DEBUG_HANDLES` is set.
- Ensure the helper is tree-shakeable (no dependency on jest/mocha) so it can run under `tsx`.
- Document the convention in `docs/architecture.md` or a dedicated testing guide.

## Acceptance Criteria
- Every e2e script uses the helper and exits deterministically.
- `npm run test:e2e` completes without manual `Ctrl+C`.
- New helper has minimal footprint; TypeScript builds remain green.
