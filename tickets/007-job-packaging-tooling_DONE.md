# Ticket 007: Job Bundle Packaging & Publishing Tooling

## Summary
Deliver developer tooling that scaffolds, validates, and publishes job bundles to the registry, ensuring consistent manifests and reproducible builds.

## Problem Statement
Without ergonomic tooling, teams cannot easily author or release dynamic job handlers. Manual packaging increases risk of malformed manifests and brings friction to adoption.

## Scope & Requirements
- Provide a CLI (`apphub jobs package`) that scaffolds a bundle (manifest, handler entrypoint, tests) and produces a signed tarball.
- Implement manifest validation (JSON Schema) and checksum calculation aligned with the registry contract.
- Support local testing harness: run the job handler with sample inputs before publishing.
- Integrate publishing workflow (`apphub jobs publish`) that authenticates with the job registry and uploads artifacts.
- Document bundle structure, required exports, and capability declarations.

## Non-Goals
- Runtime execution environment changes (handled separately).
- UI dashboards for bundle publishing (CLI only for MVP).

## Acceptance Criteria
- Developers can scaffold a new bundle, run local smoke tests, and publish to a development registry in under a few commands.
- CLI enforces manifest schema and fails builds with descriptive errors when requirements are unmet.
- Publishing outputs artifact URL/version confirmation and writes audit logs via registry API.

## Dependencies
- Ticket 006 job registry endpoints.
- Existing developer auth mechanisms (operator tokens or service tokens).

## Testing Notes
- CLI unit tests for scaffold, package, and publish flows (using temp directories).
- End-to-end test against a mocked registry verifying upload + validation pipeline.
