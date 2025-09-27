# Ticket 080: Centralize Example Configuration Descriptor

## Problem Statement
Example service manifests currently embed `$var` placeholder definitions directly in each env entry. This forces every service to repeat default values and descriptions and ties placeholder discovery to manifest parsing. With the goal of configuring examples/plugins entirely at runtime, we need a single descriptor that captures module-level configuration (placeholders, manifests, bootstrap actions) and lives at the example root. Without it, operators must maintain duplicate metadata, and services cannot consume a cohesive runtime config once placeholders are resolved.

## Goals
- Introduce a `config.json` descriptor at the root of each example/module that defines placeholders, linked manifests, bootstrap plans, and any additional assets.
- Relocate placeholder metadata (name, description, default) from `$var` entries in manifests into the descriptor, while allowing services to continue referencing `${PLACEHOLDER}` values.
- Update the catalog service-config loader to source placeholder metadata and values from the descriptor, apply them to manifests, and keep compatibility with existing `service-config.json` consumers during the transition.
- Document the new structure so example authors can supply configuration without modifying core code.

## Non-Goals
- Replacing the entire service-manifest schema or changing runtime env resolution logic beyond how placeholder metadata is sourced.
- Overhauling bootstrap execution beyond pointing it at the new descriptor structure.

## Implementation Sketch
1. Design the `config.json` schema (TypeScript types + JSON schema) describing placeholders, manifests, bootstrap actions, and optional linked assets. Include a migration path from `service-config.json` (e.g., loader accepts both file names).
2. Extend `serviceConfigLoader` to read the descriptor, hydrate placeholder metadata, and map them onto all manifest/network env occurrences before validation. Preserve backward compatibility by supporting `$var` entries when metadata is absent.
3. Teach import flows (`/service-config/import`, `/service-networks/import`) to allow the new file location (root-level `config.json`) and emit helpful errors when placeholders lack defaults or provided values.
4. Update docs/examples (start with environmental observatory) to ship the descriptor, minimizing `$var` usage inside manifests. Provide a shim `service-config.json` pointing at the descriptor for legacy tooling if necessary.
5. Add tests covering descriptor parsing, placeholder propagation, mixed legacy/new placeholders, and bootstrap execution using descriptor-provided variables.

## Deliverables
- `config.json` schema with TypeScript typings and validation utilities.
- Updated loader and import endpoints sourcing placeholder metadata from the descriptor while preserving legacy support.
- Migrated exemplar module (environmental observatory event-driven) demonstrating the new layout and documentation describing author workflow.
- Automated tests verifying placeholder resolution, backward compatibility, and bootstrap behavior with the descriptor.
