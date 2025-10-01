# Preserve service registry for external Docker services

## Context
- Module-managed services now self-register via the module runtime, so we no longer need to probe container IP/port for observatory targets.
- Some teams still onboard third-party Docker/Kubernetes services that are not packaged as AppHub modules.
- The existing service registry stores host/port, health snapshots, and OpenAPI metadata for those external services, but the current code assumes every service comes from manifest imports.

## Impact
- Removing the legacy registry would break monitoring and discovery for externally hosted services.
- Without a way to register non-module services, operators can’t roll out or observe partner containers through AppHub Core.
- Keeping two parallel pathways (modules vs manifests) without a clear boundary adds maintenance risk.

## Proposed direction
1. Split service records by source: module targets declare their own endpoints, while external Docker services continue to use the legacy manifest flow.
2. Introduce a `source` flag and optional endpoint fields in the registry schema so modules can opt out of dynamic discovery while external services still supply host/port.
3. Update the registry loader to skip health polling for module services and retain the existing checks for external ones.
4. Provide CLI/API helpers for registering external services explicitly, instead of relying on manifest backfills.

## Acceptance criteria
- Database schema and registry code distinguish between `module` and `external` service entries.
- Module services no longer require stored host/port details, but external services still publish health and routing metadata.
- Admin APIs and UI surfaces display both types clearly, with filtering by source.
- Documentation covers how to register external Docker services alongside modules.
