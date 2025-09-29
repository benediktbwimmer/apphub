# Ticket 501: Centralize Retry/Backoff Configuration Helpers

## Problem
Each catalog worker (workflow orchestrator, event ingress, trigger processor, admin routes) hand-rolls identical `normalizePositiveNumber` logic and retry defaults. Divergent updates risk drift between services and make it tedious to adjust retry policy across the stack.

## Proposal
- Extract shared retry/backoff config helpers into `packages/shared/retries/`, encapsulating number coercion, ratio clamping, and default resolution.
- Update `workflowOrchestrator`, `eventIngressWorker`, `eventTriggerProcessor`, and admin stats endpoints to consume the new helper.
- Add unit tests covering edge cases (negative input, non-numeric strings, clamp bounds) to prevent regressions.
- Provide a short migration guide in `docs/runbooks/` for teams adding new workers.

## Deliverables
- New shared retry utility with comprehensive test coverage.
- Refactored workers/routes with reduced duplication and consistent defaults.
- Documentation snippet describing usage and extension points.

## Risks & Mitigations
- **Behaviour drift:** Ensure default values remain unchanged by snapshotting current configuration in tests before swapping implementations.
- **Adoption lag:** Communicate the new helper to service owners and lint for future reintroductions of bespoke normalizers.
