# Ticket 006: Dynamic Job Registry Service

## Summary
Build a dedicated job registry that stores metadata and artifacts for dynamically loadable job bundles, enabling the catalog API and workers to discover and fetch handlers at runtime.

## Problem Statement
Job handlers are currently hardcoded inside the catalog service. This prevents external teams from publishing automation, blocks independent versioning, and complicates updates. We need a centralized registry like the service registry to manage job bundles and expose them over an API.

## Scope & Requirements
- Design the registry data model (job bundle manifest, versioning, checksum, capability flags).
- Provide CRUD APIs for publishing bundles, listing versions, fetching artifacts, and marking releases deprecated.
- Support storage backends for bundle binaries (initially local filesystem/S3-compatible blob store) with signed URLs.
- Integrate authentication and audit logging consistent with operator token flows.
- Emit events when new versions are published so downstream systems can refresh caches.

## Non-Goals
- Implement worker-side execution or sandboxing (covered by later tickets).
- Define CI tooling for packaging bundles.

## Acceptance Criteria
- Catalog can query the registry for a slug and receive manifest + download URL.
- Registry validates manifest schema and stores metadata with version history.
- Publishing enforces unique slug@version, optional immutable flag, and records who published.
- Events or change feed allow consumers to subscribe for updates.

## Dependencies
- Existing service registry patterns for reference.
- Auth/token infrastructure in catalog.

## Testing Notes
- Unit tests for manifest validation and API contract.
- Integration tests covering publish → fetch roundtrip with mocked storage.
