# Update documentation and validation for module architecture

## Context
- Transitioning to modules affects developer workflows, test harnesses, and documentation across the repo.
- Existing guides in `examples/environmental-observatory-event-driven/README.md` and other docs reference legacy commands and directory structures.
- New module capabilities introduce behaviors (context settings, capability overrides) that need clear developer guidance and automated coverage.

## Impact
- Without refreshed documentation, contributors will struggle to adopt the module runtime and may continue using deprecated patterns.
- Test suites currently target the old entry points; failing to align them will hide regressions or break CI once the migration lands.
- External partners evaluating modules will lack authoritative reference material, slowing adoption.

## Proposed direction
1. Rewrite observatory scenario docs to point to the module directory, describe the new runtime concepts, and outline how to run jobs/services via the module build pipeline.
2. Add a top-level architecture note under `docs/` that explains modules, capability injection, and the hybrid SDK approach for service clients.
3. Update integration and benchmark tests to import modules through the new APIs, ensuring they validate the module implementation end-to-end.
4. Provide example configuration/secrets templates that match the module tooling, replacing the legacy instructions scattered across READMEs.
5. Capture manual validation steps and troubleshooting tips for the module workflow so onboarding remains smooth.

## Acceptance criteria
- Observatories README and related docs reference the module layout and no longer mention the deprecated `examples/` paths.
- A new architectural document describes module concepts, SDK capabilities, and extension patterns.
- Integration/benchmark tests execute against the module entry points and pass in CI.
- Example configuration templates align with the module tooling outputs.
- Documentation includes manual validation guidance for running the module locally.
